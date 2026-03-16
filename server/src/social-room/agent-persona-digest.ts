import fs from "node:fs/promises";
import path from "node:path";
import { normalizeAgentUrlKey } from "@orchestorai/shared";
import { resolveOrchestorAIInstanceRoot } from "../home-paths.js";

const MAX_AGENTS_DIGEST_CHARS = 1_200;
const MAX_SOUL_DIGEST_CHARS = 300;

type AgentDigestInput = {
  id: string;
  name: string;
  role: string | null;
  title: string | null;
  capabilities: string | null;
  adapterConfig: Record<string, unknown>;
};

type DigestCacheEntry = {
  agentsMtimeMs: number | null;
  soulMtimeMs: number | null;
  digest: string;
};

const digestCache = new Map<string, DigestCacheEntry>();

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolveAgentHomePath(agent: AgentDigestInput) {
  const configuredInstructionsPath = readNonEmptyString(agent.adapterConfig.instructionsFilePath);
  if (configuredInstructionsPath) {
    return path.dirname(configuredInstructionsPath);
  }

  const slug = normalizeAgentUrlKey(agent.name) ?? normalizeAgentUrlKey(agent.title) ?? agent.id;
  return path.resolve(resolveOrchestorAIInstanceRoot(), "agents", slug);
}

async function safeReadFile(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function safeMtimeMs(filePath: string) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() ? stats.mtimeMs : null;
  } catch {
    return null;
  }
}

function stripMarkdown(value: string | null, maxChars: number) {
  if (!value) return "";
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#+\s*/gm, " ")
    .replace(/^\s*[-*]\s*/gm, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function buildFallbackDigest(agent: AgentDigestInput) {
  return [
    agent.title ? `Title: ${agent.title}` : null,
    agent.role ? `Role: ${agent.role}` : null,
    agent.capabilities ? `Capabilities: ${agent.capabilities}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join(" | ");
}

export async function resolveAgentPersonaDigest(agent: AgentDigestInput) {
  const agentHomePath = resolveAgentHomePath(agent);
  const agentsPath = path.resolve(agentHomePath, "AGENTS.md");
  const soulPath = path.resolve(agentHomePath, "SOUL.md");
  const [agentsMtimeMs, soulMtimeMs] = await Promise.all([
    safeMtimeMs(agentsPath),
    safeMtimeMs(soulPath),
  ]);
  const cacheKey = `${agentsPath}:${soulPath}`;
  const cached = digestCache.get(cacheKey);

  if (
    cached &&
    cached.agentsMtimeMs === agentsMtimeMs &&
    cached.soulMtimeMs === soulMtimeMs
  ) {
    return {
      agentHomePath,
      digest: cached.digest,
    };
  }

  const [agentsContent, soulContent] = await Promise.all([
    safeReadFile(agentsPath),
    safeReadFile(soulPath),
  ]);

  const digest = [
    buildFallbackDigest(agent),
    stripMarkdown(agentsContent, MAX_AGENTS_DIGEST_CHARS),
    stripMarkdown(soulContent, MAX_SOUL_DIGEST_CHARS),
  ]
    .filter((line) => line.length > 0)
    .join(" | ");

  const resolvedDigest = digest || buildFallbackDigest(agent) || agent.name;
  digestCache.set(cacheKey, {
    agentsMtimeMs,
    soulMtimeMs,
    digest: resolvedDigest,
  });

  return {
    agentHomePath,
    digest: resolvedDigest,
  };
}

export function resetAgentPersonaDigestCacheForTests() {
  digestCache.clear();
}
