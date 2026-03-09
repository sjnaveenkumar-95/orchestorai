import { deriveAgentUrlKey } from "./agent-url-key.js";
import { deriveProjectUrlKey } from "./project-url-key.js";

export type ReferenceEntityKind = "agent" | "project";

export interface ReferenceAliases {
  aliasMode: string;
  primaryAlias: string;
  aliases: string[];
}

const NORMALIZE_DELIM_RE = /[^a-z0-9]+/g;
const NORMALIZE_TRIM_RE = /^-+|-+$/g;
const PAREN_CONTENT_RE = /\([^)]*\)/g;

const RESERVED_ALIASES: Record<ReferenceEntityKind, Set<string>> = {
  agent: new Set(["orchestorai", "here", "channel", "everyone"]),
  project: new Set(["project", "proj"]),
};

const STOPWORDS: Record<ReferenceEntityKind, Set<string>> = {
  agent: new Set([
    "agent",
    "developer",
    "dev",
    "engineer",
    "founding",
    "junior",
    "lead",
    "manager",
    "officer",
    "principal",
    "senior",
    "sde",
    "staff",
    "team",
  ]),
  project: new Set([
    "ai",
    "app",
    "auto",
    "platform",
    "project",
    "service",
    "system",
    "tool",
  ]),
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stripParentheticalSegments(value: string | null | undefined): string {
  return String(value || "").replace(PAREN_CONTENT_RE, " ").replace(/\s+/g, " ").trim();
}

function splitRawTokens(value: string | null | undefined): string[] {
  return stripParentheticalSegments(value)
    .split(/[^A-Za-z0-9]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniqueAliases(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeReferenceAlias(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function isUpperAcronymToken(value: string): boolean {
  return value.length >= 2 && value.length <= 5 && value === value.toUpperCase() && /[A-Z]/.test(value);
}

function shouldAllowPrimaryToken(kind: ReferenceEntityKind, rawToken: string, normalizedToken: string, tokenCount: number) {
  if (normalizedToken.length >= 3) return true;
  if (kind === "agent" && isUpperAcronymToken(rawToken)) return true;
  if (kind === "project" && tokenCount === 1 && isUpperAcronymToken(rawToken)) return true;
  return false;
}

function buildSignificantTokens(kind: ReferenceEntityKind, rawTokens: string[]): string[] {
  const normalizedTokens = rawTokens.map((entry) => normalizeReferenceAlias(entry)).filter(Boolean) as string[];
  const significant = normalizedTokens.filter((token) => !STOPWORDS[kind].has(token));
  return significant.length > 0 ? significant : normalizedTokens;
}

function defaultBaseAlias(kind: ReferenceEntityKind, name: string, urlKey?: string | null): string {
  if (kind === "agent") {
    return deriveAgentUrlKey(name, urlKey);
  }
  return deriveProjectUrlKey(name, urlKey);
}

function nextAvailableAlias(baseAlias: string, takenAliases: Set<string>): string {
  const base = normalizeReferenceAlias(baseAlias) ?? "item";
  if (!takenAliases.has(base)) {
    return base;
  }
  for (let index = 2; index <= 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!takenAliases.has(candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now()}`;
}

export function normalizeReferenceAlias(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^[@#]+/, "")
    .replace(NORMALIZE_DELIM_RE, "-")
    .replace(NORMALIZE_TRIM_RE, "");
  return normalized.length > 0 ? normalized : null;
}

export function readReferenceAliases(metadata: unknown): ReferenceAliases | null {
  const references = asRecord(asRecord(metadata)?.references);
  if (!references) return null;

  const aliases = uniqueAliases(
    Array.isArray(references.aliases) ? references.aliases.map((entry) => String(entry || "")) : [],
  ).filter((alias) => !RESERVED_ALIASES.agent.has(alias) && !RESERVED_ALIASES.project.has(alias));
  const primaryAlias = normalizeReferenceAlias(String(references.primaryAlias || ""));
  const aliasMode = typeof references.aliasMode === "string" && references.aliasMode.trim()
    ? references.aliasMode.trim()
    : "generated";

  if (aliases.length === 0 && !primaryAlias) {
    return null;
  }

  const orderedAliases = uniqueAliases([primaryAlias, ...aliases]);
  if (orderedAliases.length === 0) {
    return null;
  }

  return {
    aliasMode,
    primaryAlias: orderedAliases[0],
    aliases: orderedAliases,
  };
}

export function mergeReferenceAliasesMetadata(
  metadata: Record<string, unknown> | null | undefined,
  references: ReferenceAliases,
): Record<string, unknown> {
  const base = asRecord(metadata) ? { ...(metadata as Record<string, unknown>) } : {};
  const existingReferences = asRecord(base.references);
  base.references = {
    ...(existingReferences ?? {}),
    aliasMode: references.aliasMode,
    primaryAlias: references.primaryAlias,
    aliases: uniqueAliases(references.aliases),
  };
  return base;
}

export function removeReferenceAliasesMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const base = asRecord(metadata) ? { ...(metadata as Record<string, unknown>) } : null;
  if (!base) return null;
  const references = asRecord(base.references);
  if (!references) return base;
  const nextReferences = { ...references };
  delete nextReferences.aliasMode;
  delete nextReferences.primaryAlias;
  delete nextReferences.aliases;
  if (Object.keys(nextReferences).length === 0) {
    delete base.references;
  } else {
    base.references = nextReferences;
  }
  return Object.keys(base).length > 0 ? base : null;
}

export function buildReferenceAliasCandidates(input: {
  kind: ReferenceEntityKind;
  name: string;
  urlKey?: string | null;
}): string[] {
  const rawTokens = splitRawTokens(input.name);
  const significantTokens = buildSignificantTokens(input.kind, rawTokens);
  const primaryToken = significantTokens[0] ?? null;
  const primaryRawToken = rawTokens.find((entry) => normalizeReferenceAlias(entry) === primaryToken) ?? "";
  const fullAlias = normalizeReferenceAlias(defaultBaseAlias(input.kind, input.name, input.urlKey));
  const candidates = uniqueAliases([
    primaryToken && shouldAllowPrimaryToken(input.kind, primaryRawToken, primaryToken, rawTokens.length)
      ? primaryToken
      : null,
    significantTokens.length >= 2 ? significantTokens.slice(0, 2).join("-") : null,
    significantTokens.length >= 2 ? significantTokens.slice(-2).join("-") : null,
    fullAlias,
  ]);

  return candidates.filter((alias) => !RESERVED_ALIASES[input.kind].has(alias));
}

export function generateUniqueReferenceAliases(input: {
  kind: ReferenceEntityKind;
  name: string;
  urlKey?: string | null;
  takenAliases?: Iterable<string>;
}): ReferenceAliases {
  const takenAliases = new Set<string>();
  for (const alias of input.takenAliases ?? []) {
    const normalized = normalizeReferenceAlias(alias);
    if (normalized) {
      takenAliases.add(normalized);
    }
  }
  for (const alias of RESERVED_ALIASES[input.kind]) {
    takenAliases.add(alias);
  }

  const aliases: string[] = [];
  for (const candidate of buildReferenceAliasCandidates(input)) {
    if (takenAliases.has(candidate)) continue;
    aliases.push(candidate);
    takenAliases.add(candidate);
  }

  if (aliases.length === 0) {
    const fallbackAlias = nextAvailableAlias(defaultBaseAlias(input.kind, input.name, input.urlKey), takenAliases);
    aliases.push(fallbackAlias);
  }

  return {
    aliasMode: "generated",
    primaryAlias: aliases[0]!,
    aliases,
  };
}
