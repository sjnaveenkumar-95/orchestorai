import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { onboard } from "./onboard.js";
import { doctor } from "./doctor.js";
import { configExists, resolveConfigPath } from "../config/store.js";
import {
  describeLocalInstancePaths,
  resolveOrchestorAIHomeDir,
  resolveOrchestorAIInstanceId,
} from "../config/home.js";

interface RunOptions {
  config?: string;
  instance?: string;
  repair?: boolean;
  yes?: boolean;
}

export async function runCommand(opts: RunOptions): Promise<void> {
  const instanceId = resolveOrchestorAIInstanceId(opts.instance);
  process.env.ORCHESTORAI_INSTANCE_ID = instanceId;

  const homeDir = resolveOrchestorAIHomeDir();
  fs.mkdirSync(homeDir, { recursive: true });

  const paths = describeLocalInstancePaths(instanceId);
  fs.mkdirSync(paths.instanceRoot, { recursive: true });

  const configPath = resolveConfigPath(opts.config);
  process.env.ORCHESTORAI_CONFIG = configPath;

  p.intro(pc.bgCyan(pc.black(" orchestorai run ")));
  p.log.message(pc.dim(`Home: ${paths.homeDir}`));
  p.log.message(pc.dim(`Instance: ${paths.instanceId}`));
  p.log.message(pc.dim(`Config: ${configPath}`));

  if (!configExists(configPath)) {
    const isInteractive = process.stdin.isTTY && process.stdout.isTTY;
    if (!isInteractive && !opts.yes) {
      p.log.error("No config found and terminal is non-interactive.");
      p.log.message(`Run ${pc.cyan("orchestorai onboard")} once, then retry ${pc.cyan("orchestorai run")}.`);
      process.exit(1);
    }

    if (!isInteractive && opts.yes) {
      p.log.message(pc.dim("Non-interactive terminal detected; using quickstart onboarding defaults because --yes was set."));
    }
    p.log.step("No config found. Starting onboarding...");
    await onboard({ config: configPath, invokedByRun: true, yes: opts.yes });
  }

  p.log.step("Running doctor checks...");
  const summary = await doctor({
    config: configPath,
    repair: opts.repair ?? true,
    yes: opts.yes ?? true,
  });

  if (summary.failed > 0) {
    p.log.error("Doctor found blocking issues. Not starting server.");
    process.exit(1);
  }

  p.log.step("Starting OrchestorAI server...");
  await importServerEntry();
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    if (err.message && err.message.trim().length > 0) return err.message;
    return err.name;
  }
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function isModuleNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  if (code === "ERR_MODULE_NOT_FOUND") return true;
  return err.message.includes("Cannot find module");
}

function getMissingModuleSpecifier(err: unknown): string | null {
  if (!(err instanceof Error)) return null;
  const packageMatch = err.message.match(/Cannot find package '([^']+)' imported from/);
  if (packageMatch?.[1]) return packageMatch[1];
  const moduleMatch = err.message.match(/Cannot find module '([^']+)'/);
  if (moduleMatch?.[1]) return moduleMatch[1];
  return null;
}

function maybeEnableUiDevMiddleware(entrypoint: string): void {
  if (process.env.ORCHESTORAI_UI_DEV_MIDDLEWARE !== undefined) return;
  const normalized = entrypoint.replaceAll("\\", "/");
  if (normalized.endsWith("/server/src/index.ts") || normalized.endsWith("@orchestorai/server/src/index.ts")) {
    process.env.ORCHESTORAI_UI_DEV_MIDDLEWARE = "true";
  }
}

async function importServerEntry(): Promise<void> {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const distEntry = path.resolve(projectRoot, "server/dist/index.js");
  if (process.env.NODE_ENV === "production" && fs.existsSync(distEntry)) {
    await import(pathToFileURL(distEntry).href);
    return;
  }

  // Dev mode: try local workspace path (monorepo with tsx)
  const devEntry = path.resolve(projectRoot, "server/src/index.ts");
  if (fs.existsSync(devEntry)) {
    maybeEnableUiDevMiddleware(devEntry);
    await import(pathToFileURL(devEntry).href);
    return;
  }

  // Production mode: import the published @orchestorai/server package
  try {
    await import("@orchestorai/server");
  } catch (err) {
    const missingSpecifier = getMissingModuleSpecifier(err);
    const missingServerEntrypoint = !missingSpecifier || missingSpecifier === "@orchestorai/server";
    if (isModuleNotFoundError(err) && missingServerEntrypoint) {
      throw new Error(
        `Could not locate a OrchestorAI server entrypoint.\n` +
          `Tried: ${devEntry}, @orchestorai/server\n` +
          `${formatError(err)}`,
      );
    }
    throw new Error(
      `OrchestorAI server failed to start.\n` +
        `${formatError(err)}`,
    );
  }
}
