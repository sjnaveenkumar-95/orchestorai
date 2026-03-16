import { randomUUID } from "node:crypto";
import {
  shortlistSocialSpeakerCandidates,
  type SocialSpeakerCandidate,
  type SocialSpeakerSelectionDecision,
  type SocialSpeakerSelectionMode,
  validateSocialSpeakerSelectionDecision,
} from "@orchestorai/social-room-runtime";
import { DEFAULT_CODEX_LOCAL_MODEL } from "@orchestorai/adapter-codex-local";
import { parseCodexJsonl } from "@orchestorai/adapter-codex-local/server";
import {
  ensureCommandResolvable,
  ensurePathInEnv,
  runChildProcess,
} from "@orchestorai/adapter-utils/server-utils";
import { readConfigFile } from "../config-file.js";
import { logger } from "../middleware/logger.js";

const SELECTOR_TIMEOUT_MS = 60_000;
const SELECTOR_TIMEOUT_SEC = Math.ceil(SELECTOR_TIMEOUT_MS / 1000);
const SELECTOR_GRACE_SEC = 5;
const CODEX_SELECTOR_COMMAND = "codex";
const OPENAI_SELECTOR_MODEL = DEFAULT_CODEX_LOCAL_MODEL;
const ANTHROPIC_SELECTOR_MODEL = "claude-3-5-haiku-latest";
type SelectorReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface SelectSocialRoomSpeakersInput {
  companyId: string;
  roomId: string;
  mode: SocialSpeakerSelectionMode;
  maxSelections: number;
  recentConversationText: string;
  candidates: SocialSpeakerCandidate[];
  fallbackAgentIds: string[];
  preferredAgentIds?: string[];
  recentSpeakerAgentIds?: string[];
  immediatePreviousSpeakerAgentId?: string | null;
}

export interface SelectSocialRoomSpeakersResult {
  source: "llm" | "fallback";
  decision: SocialSpeakerSelectionDecision;
  fallbackReason: string | null;
  shortlistedAgentIds: string[];
  cameoAgentIds: string[];
}

type ProviderConfig =
  | {
      provider: "openai";
      apiKey: string | null;
      model: string;
      reasoningEffort: SelectorReasoningEffort | null;
      command: string;
    }
  | { provider: "claude"; apiKey: string; model: string };

function buildFallbackDecision(input: SelectSocialRoomSpeakersInput): SocialSpeakerSelectionDecision {
  const selectedAgentIds = input.fallbackAgentIds.slice(0, Math.max(0, input.maxSelections));
  return {
    selectedAgentIds,
    stop: input.mode === "follow_on" ? selectedAgentIds.length === 0 : false,
    allowImmediateRepeat: false,
    summary: "Fallback social-room speaker selection",
  };
}

function resolveProviderConfig(): ProviderConfig | null {
  const config = readConfigFile();
  const provider = config?.llm?.provider;
  if (!provider) return null;

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY?.trim() || config.llm?.apiKey?.trim() || null;
    const model = config.llm?.model?.trim() || OPENAI_SELECTOR_MODEL;
    const reasoningEffort = config.llm?.reasoningEffort ?? null;
    return { provider, apiKey, model, reasoningEffort, command: CODEX_SELECTOR_COMMAND };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || config.llm?.apiKey?.trim();
  const model = config.llm?.model?.trim() || ANTHROPIC_SELECTOR_MODEL;
  return apiKey ? { provider, apiKey, model } : null;
}

function extractJsonObject(raw: string) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("No JSON object found in selector response");
  }
  return trimmed.slice(firstBrace, lastBrace + 1);
}

function excerpt(value: string, maxChars = 400) {
  const normalized = value.trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}...`;
}

function parseDecision(raw: unknown): SocialSpeakerSelectionDecision {
  if (!raw || typeof raw !== "object") {
    throw new Error("Selector response is not an object");
  }
  const candidate = raw as Record<string, unknown>;
  return {
    selectedAgentIds: Array.isArray(candidate.selectedAgentIds)
      ? candidate.selectedAgentIds.filter((value): value is string => typeof value === "string")
      : [],
    stop: candidate.stop === true,
    allowImmediateRepeat: candidate.allowImmediateRepeat === true,
    summary: typeof candidate.summary === "string" ? candidate.summary : "",
  };
}

function buildCandidateSummary(candidate: SocialSpeakerCandidate) {
  return {
    id: candidate.id,
    name: candidate.name,
    role: candidate.role,
    title: candidate.title,
    capabilities: candidate.capabilities,
    personaDigest: candidate.personaDigest,
  };
}

function buildPrompt(input: {
  mode: SocialSpeakerSelectionMode;
  maxSelections: number;
  recentConversationText: string;
  candidates: SocialSpeakerCandidate[];
  cameoAgentIds: string[];
  preferredAgentIds?: string[];
  immediatePreviousSpeakerAgentId?: string | null;
}) {
  return [
    "You are selecting which company agents should speak next in a casual Slack social-room thread.",
    `Mode: ${input.mode}`,
    `Maximum selections: ${input.maxSelections}`,
    input.immediatePreviousSpeakerAgentId
      ? `Immediate previous agent speaker: ${input.immediatePreviousSpeakerAgentId}`
      : null,
    input.cameoAgentIds.length > 0
      ? `At most one cameo selection may come from these ids: ${input.cameoAgentIds.join(", ")}`
      : null,
    input.preferredAgentIds && input.preferredAgentIds.length > 0
      ? `Prefer these explicitly mentioned colleague ids when the reply would feel natural: ${input.preferredAgentIds.join(", ")}`
      : null,
    "Prefer directly relevant agents first. Less-relevant agents may appear only as an occasional cameo if they can add a natural reaction or adjacent perspective.",
    input.maxSelections === 1
      ? "Pick the single best next speaker, not a representative set of roles."
      : null,
    "Avoid immediate back-to-back repeats unless the same agent clearly should continue. If you choose that, set allowImmediateRepeat to true.",
    input.mode === "follow_on"
      ? "In follow_on mode, prefer continuing with a natural next reply unless the thread is clearly exhausted."
      : null,
    "If mode is follow_on and nobody should speak next, return selectedAgentIds as [] and stop as true.",
    "Return JSON only with this exact shape:",
    '{"selectedAgentIds":["agent-id"],"stop":false,"allowImmediateRepeat":false,"summary":"short reason"}',
    "",
    "Recent conversation:",
    input.recentConversationText.trim(),
    "",
    "Candidate agents:",
    JSON.stringify(input.candidates.map((candidate) => buildCandidateSummary(candidate)), null, 2),
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

async function callCodexCliSelector(
  command: string,
  apiKey: string | null,
  model: string,
  reasoningEffort: SelectorReasoningEffort | null,
  prompt: string,
) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  if (apiKey && apiKey.trim().length > 0) {
    env.OPENAI_API_KEY = apiKey;
  }

  const runtimeEnv = ensurePathInEnv(env) as Record<string, string>;
  const cwd = process.cwd();
  await ensureCommandResolvable(command, cwd, runtimeEnv);

  const args = ["exec", "--json", "--model", model];
  if (reasoningEffort) {
    args.push("-c", `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`);
  }
  args.push("-");

  const proc = await runChildProcess(
    `social-room-selector-${randomUUID()}`,
    command,
    args,
    {
      cwd,
      env: runtimeEnv,
      timeoutSec: SELECTOR_TIMEOUT_SEC,
      graceSec: SELECTOR_GRACE_SEC,
      stdin: prompt,
      onLog: async () => {},
    },
  );

  if (proc.timedOut) {
    throw new Error("Codex selector timed out");
  }
  if ((proc.exitCode ?? 0) !== 0) {
    throw new Error(
      `Codex selector exited with code ${proc.exitCode ?? -1}` +
        (proc.stderr.trim() ? `: ${excerpt(proc.stderr)}` : ""),
    );
  }

  const parsed = parseCodexJsonl(proc.stdout);
  if (parsed.errorMessage) {
    throw new Error(parsed.errorMessage);
  }
  if (!parsed.summary.trim()) {
    throw new Error(
      "No selector response from Codex" +
        (proc.stdout.trim() ? `; stdout=${excerpt(proc.stdout)}` : "") +
        (proc.stderr.trim() ? `; stderr=${excerpt(proc.stderr)}` : ""),
    );
  }

  return parseDecision(JSON.parse(extractJsonObject(parsed.summary)));
}

async function callAnthropicSelector(apiKey: string, model: string, prompt: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SELECTOR_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        temperature: 0.2,
        system: "Return only valid JSON. Do not wrap it in Markdown.",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Anthropic selector request failed with status ${response.status}`);
    }
    const payload = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const content = payload.content
      ?.filter((entry) => entry.type === "text" && typeof entry.text === "string")
      .map((entry) => entry.text)
      .join("\n") ?? "";
    return parseDecision(JSON.parse(extractJsonObject(content)));
  } finally {
    clearTimeout(timeout);
  }
}

async function callSelectorLlm(config: ProviderConfig, prompt: string) {
  if (config.provider === "openai") {
    return callCodexCliSelector(
      config.command,
      config.apiKey,
      config.model,
      config.reasoningEffort,
      prompt,
    );
  }
  return callAnthropicSelector(config.apiKey, config.model, prompt);
}

export async function selectSocialRoomSpeakers(
  input: SelectSocialRoomSpeakersInput,
): Promise<SelectSocialRoomSpeakersResult> {
  const shortlist = shortlistSocialSpeakerCandidates({
    maxCandidates: 12,
    recentConversationText: input.recentConversationText,
    candidates: input.candidates,
    recentSpeakerAgentIds: input.recentSpeakerAgentIds,
    preferredAgentIds: input.preferredAgentIds,
  });
  const fallbackDecision = buildFallbackDecision(input);
  const providerConfig = resolveProviderConfig();

  if (!providerConfig) {
    return {
      source: "fallback",
      decision: fallbackDecision,
      fallbackReason: "llm_config_missing",
      shortlistedAgentIds: shortlist.candidates.map((candidate) => candidate.id),
      cameoAgentIds: shortlist.cameoCandidateIds,
    };
  }

  try {
    const llmDecision = await callSelectorLlm(
      providerConfig,
      buildPrompt({
        mode: input.mode,
        maxSelections: input.maxSelections,
        recentConversationText: input.recentConversationText,
        candidates: shortlist.candidates,
        cameoAgentIds: shortlist.cameoCandidateIds,
        preferredAgentIds: input.preferredAgentIds,
        immediatePreviousSpeakerAgentId: input.immediatePreviousSpeakerAgentId,
      }),
    );

    const validated = validateSocialSpeakerSelectionDecision({
      mode: input.mode,
      maxSelections: input.maxSelections,
      candidateIds: new Set(shortlist.candidates.map((candidate) => candidate.id)),
      decision: llmDecision,
      fallbackDecision,
      immediatePreviousSpeakerAgentId: input.immediatePreviousSpeakerAgentId,
      cameoCandidateIds: new Set(shortlist.cameoCandidateIds),
    });

    if (!validated.isUsable || validated.invalidReason) {
      return {
        source: "fallback",
        decision: fallbackDecision,
        fallbackReason: "selector_invalid",
        shortlistedAgentIds: shortlist.candidates.map((candidate) => candidate.id),
        cameoAgentIds: shortlist.cameoCandidateIds,
      };
    }

    return {
      source: "llm",
      decision: {
        selectedAgentIds: validated.selectedAgentIds,
        stop: validated.stop,
        allowImmediateRepeat: validated.allowImmediateRepeat,
        summary: validated.summary,
      },
      fallbackReason: null,
      shortlistedAgentIds: shortlist.candidates.map((candidate) => candidate.id),
      cameoAgentIds: shortlist.cameoCandidateIds,
    };
  } catch (error) {
    logger.warn(
      {
        err: error,
        companyId: input.companyId,
        roomId: input.roomId,
        mode: input.mode,
        maxSelections: input.maxSelections,
      },
      "social-room speaker selector failed; falling back",
    );
    return {
      source: "fallback",
      decision: fallbackDecision,
      fallbackReason: "selector_error",
      shortlistedAgentIds: shortlist.candidates.map((candidate) => candidate.id),
      cameoAgentIds: shortlist.cameoCandidateIds,
    };
  }
}
