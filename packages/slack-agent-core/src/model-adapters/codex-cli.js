import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";

function clipError(reason, max = 900) {
  if (!reason) return "";
  if (reason.length <= max) return reason;
  return `${reason.slice(0, max - 3)}...`;
}

function runProcess(command, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${command} timed out after ${timeoutMs}ms`));
        return;
      }
      if (code !== 0) {
        const details = clipError(stderr.trim() || stdout.trim());
        reject(
          new Error(
            `${command} failed (code=${code}${signal ? `, signal=${signal}` : ""})${details ? `: ${details}` : ""}`,
          ),
        );
        return;
      }
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

function isLoggedInText(raw) {
  const normalized = String(raw || "").toLowerCase();
  return normalized.includes("logged in") && !normalized.includes("not logged in");
}

export function buildCodexExecArgs({ workdir, codexCli, outputFile, prompt }) {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "-C",
    workdir,
    "-o",
    outputFile,
  ];

  if (codexCli.sandbox) args.push("-s", codexCli.sandbox);
  if (codexCli.bypassApprovalsAndSandbox) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  }
  if (codexCli.model) args.push("-m", codexCli.model);
  if (codexCli.profile) args.push("--profile", codexCli.profile);
  if (codexCli.reasoningEffort) {
    args.push("-c", `model_reasoning_effort=${JSON.stringify(codexCli.reasoningEffort)}`);
  }
  for (const dir of codexCli.additionalWritableDirs || []) {
    args.push("--add-dir", dir);
  }
  args.push(prompt);

  return args;
}

export class CodexCliModelAdapter {
  constructor(config) {
    this.config = config;
    this.queues = new Map();
  }

  async ensureReady() {
    const codex = this.config.codexCli;
    await runProcess(codex.command || "codex", ["--version"], {
      timeoutMs: 15000,
      cwd: this.config.workdir,
    });

    const status = await runProcess(codex.command || "codex", ["login", "status"], {
      timeoutMs: 15000,
      cwd: this.config.workdir,
    });
    const combined = `${status.stdout}\n${status.stderr}`;
    if (!isLoggedInText(combined)) {
      throw new Error("Codex CLI is not logged in. Run `codex login` first.");
    }
  }

  buildPrompt(input) {
    const sections = [
      this.config.systemPrompt,
      input.instructions || "",
      "Slack conversation context:",
      input.context || "(none)",
      "User message:",
      input.userText,
      "Reply directly to the user. Keep it concise unless detail is requested.",
    ];
    return sections.filter(Boolean).join("\n\n");
  }

  async request(input, queueKey = "default") {
    const previous = this.queues.get(queueKey) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => await this.#requestOnce(input))
      .finally(() => {
        if (this.queues.get(queueKey) === next) {
          this.queues.delete(queueKey);
        }
      });

    this.queues.set(queueKey, next);
    return await next;
  }

  async #requestOnce(input) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "slack-agent-core-codex-"));
    const outputFile = path.join(tempDir, "last-message.txt");
    const codex = this.config.codexCli;
    const args = buildCodexExecArgs({
      workdir: this.config.workdir,
      codexCli: codex,
      outputFile,
      prompt: this.buildPrompt(input),
    });

    try {
      await runProcess(codex.command || "codex", args, {
        timeoutMs: this.config.timeoutMs,
        cwd: this.config.workdir,
      });
      const output = (await readFile(outputFile, "utf8")).trim();
      return output || "I could not generate a response for that message.";
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
