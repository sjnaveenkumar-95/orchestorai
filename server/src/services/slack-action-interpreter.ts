import { randomUUID } from "node:crypto";
import { DEFAULT_CODEX_LOCAL_MODEL } from "@orchestorai/adapter-codex-local";
import { execute as executeCodexLocal } from "@orchestorai/adapter-codex-local/server";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@orchestorai/adapter-utils";
import type {
  SlackControlActionType,
  SlackControlInterpreterResult,
  SlackControlMessageContext,
} from "@orchestorai/shared";
import { slackControlInterpreterResultSchema } from "@orchestorai/shared";
import { createInstanceSettingsService } from "./instance-settings.js";

type CodexRunner = (ctx: AdapterExecutionContext) => Promise<AdapterExecutionResult>;

export interface SlackInterpreterCandidateAgent {
  id: string;
  name: string;
  urlKey: string | null;
  aliases: string[];
  slackKeys: string[];
}

export interface SlackInterpreterCandidateProject {
  id: string;
  name: string;
  urlKey: string | null;
  aliases: string[];
  slackKeys: string[];
}

export interface SlackInterpreterCandidateIssue {
  id: string;
  identifier: string | null;
  title: string;
  projectId: string | null;
  projectName: string | null;
  status: string;
  priority: string;
  assigneeAgentId: string | null;
}

export interface SlackInterpreterProjectContext {
  id: string;
  name: string;
  urlKey: string | null;
  status: string;
}

export interface SlackInterpreterIssueContext {
  id: string;
  identifier: string | null;
  title: string;
  description: string | null;
  projectId: string | null;
  status: string;
  priority: string;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
}

export interface SlackInterpreterHistoryEntry {
  author: string | null;
  text: string;
  ts: string;
}

export interface SlackInterpreterIssueCommentEntry {
  authorAgentId: string | null;
  authorUserId: string | null;
  body: string;
  createdAt: string;
}

export interface SlackActionInterpreterInput {
  message: SlackControlMessageContext;
  project: SlackInterpreterProjectContext | null;
  linkedIssue: SlackInterpreterIssueContext | null;
  recentSlackMessages: SlackInterpreterHistoryEntry[];
  recentIssueComments: SlackInterpreterIssueCommentEntry[];
  candidateAgents: SlackInterpreterCandidateAgent[];
  candidateProjects: SlackInterpreterCandidateProject[];
  candidateIssues: SlackInterpreterCandidateIssue[];
  allowedActions?: SlackControlActionType[];
}

type SlackInterpreterSettings = {
  enabled: boolean;
  model: string;
  profile: string | null;
  workdir: string;
  timeoutSec: number;
  contextLimit: number;
};

function readNonEmptyString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseBoolean(value: string | null | undefined, defaultValue: boolean): boolean {
  const normalized = readNonEmptyString(value)?.toLowerCase();
  if (!normalized) return defaultValue;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

function parsePositiveInteger(value: string | null | undefined, defaultValue: number): number {
  const normalized = readNonEmptyString(value);
  if (!normalized) return defaultValue;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

function sliceRecent<T>(entries: T[], limit: number): T[] {
  if (limit <= 0) return [];
  return entries.slice(Math.max(0, entries.length - limit));
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return trimmed.slice(start, end + 1);
}

function parseInterpreterResult(text: string): SlackControlInterpreterResult {
  const jsonText = extractJsonObject(text);
  if (!jsonText) {
    throw new Error("Codex did not return a JSON object.");
  }
  const parsed = JSON.parse(jsonText) as unknown;
  return slackControlInterpreterResultSchema.parse(parsed);
}

function buildClarifyResult(reply: string, reason: string): SlackControlInterpreterResult {
  return {
    actionType: "clarify",
    targetIssueRef: null,
    targetProjectRef: null,
    targetAgentRef: null,
    normalizedMutation: null,
    commentaryToPersist: null,
    slackReply: reply,
    confidence: 0,
    needsClarification: true,
    reasons: [reason],
  };
}

function renderPrompt(input: SlackActionInterpreterInput, contextLimit: number): string {
  const payload = {
    mode: "orchestorai_slack_control",
    message: input.message,
    project: input.project,
    linkedIssue: input.linkedIssue,
    recentSlackMessages: sliceRecent(input.recentSlackMessages, contextLimit),
    recentIssueComments: sliceRecent(input.recentIssueComments, contextLimit),
    candidateAgents: input.candidateAgents,
    candidateProjects: input.candidateProjects,
    candidateIssues: input.candidateIssues,
    allowedActions: input.allowedActions ?? [
      "create_issue",
      "create_child_issue",
      "update_issue",
      "add_comment",
      "checkout_issue",
      "release_issue",
      "query",
      "clarify",
      "noop",
    ],
  };

  return [
    "You are the OrchestorAI Slack control interpreter.",
    "Analyze the Slack message and produce exactly one JSON object matching the requested schema.",
    "Do not output markdown, prose, or code fences.",
    "Do not invent ids, agent refs, project refs, or issue refs.",
    "Use ids from candidate lists when possible. If the target cannot be resolved confidently, return actionType clarify.",
    "Every non-bot message in a managed OrchestorAI Slack project channel is a control-plane request.",
    "Interpret the user intent into one action only.",
    "When a managed-channel thread reply is not linked to an issue, use recentSlackMessages to continue the thread conversation and resolve clarification follow-ups.",
    "Queries and status questions should use actionType query with no mutation.",
    "If the text asks to assign, move, reprioritize, change status, or otherwise edit an issue, use update_issue.",
    "If the text creates a new ticket in the current project channel, use create_issue.",
    "If the text creates a subtask from an existing linked issue thread, use create_child_issue.",
    "If a linked issue thread is already done and the message requests new follow-up work or a new deliverable, prefer create_child_issue instead of reopening the done issue.",
    "If the text is an operational comment that should be recorded without changing fields, use add_comment.",
    "Use checkout_issue only when the message clearly asks an agent to start or take ownership now and the issue target is known.",
    "Use release_issue only when the message clearly asks to stop/release active work.",
    "Set commentaryToPersist when downstream agents should see context beyond the normalized field mutation.",
    "Set normalizedMutation.persistOriginalMessage=true when the original Slack text should be preserved verbatim in the issue history.",
    "Set confidence between 0 and 1. Use needsClarification=true if ambiguity remains.",
    "",
    "Return JSON with this shape:",
    JSON.stringify({
      actionType: "clarify",
      targetIssueRef: "issue-id-or-null",
      targetProjectRef: "project-id-or-null",
      targetAgentRef: "agent-id-or-null",
      normalizedMutation: {
        title: "optional",
        description: "optional",
        commentBody: "optional",
        status: "backlog|todo|in_progress|in_review|done|blocked|cancelled",
        priority: "critical|high|medium|low",
        assigneeAgentRef: "agent-id-or-null",
        projectRef: "project-id-or-null",
        goalRef: "goal-id-or-null",
        parentIssueRef: "issue-id-or-null",
        issueRef: "issue-id-or-null",
        expectedStatuses: ["todo"],
        persistOriginalMessage: true,
        confirmed: false,
      },
      commentaryToPersist: "optional",
      slackReply: "human-readable reply for Slack",
      confidence: 0.5,
      needsClarification: true,
      reasons: ["short reason"],
    }, null, 2),
    "",
    "Context JSON:",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

function loadSettings(
  instanceSettings: ReturnType<typeof createInstanceSettingsService>,
): SlackInterpreterSettings {
  const model = readNonEmptyString(instanceSettings.getRuntimeValue("slackInterpreterModel"))
    ?? DEFAULT_CODEX_LOCAL_MODEL;
  const profile = readNonEmptyString(instanceSettings.getRuntimeValue("slackInterpreterProfile"));
  const workdir = readNonEmptyString(instanceSettings.getRuntimeValue("slackInterpreterWorkdir"))
    ?? process.cwd();
  const timeoutSec = parsePositiveInteger(
    instanceSettings.getRuntimeValue("slackInterpreterTimeoutSec"),
    90,
  );
  const contextLimit = parsePositiveInteger(
    instanceSettings.getRuntimeValue("slackInterpreterContextLimit"),
    12,
  );
  const enabled = parseBoolean(instanceSettings.getRuntimeValue("slackInterpreterEnabled"), true);

  return {
    enabled,
    model,
    profile,
    workdir,
    timeoutSec,
    contextLimit,
  };
}

export function slackActionInterpreterService(options?: {
  runCodex?: CodexRunner;
  instanceSettings?: ReturnType<typeof createInstanceSettingsService>;
}) {
  const runCodex = options?.runCodex ?? executeCodexLocal;
  const instanceSettings = options?.instanceSettings ?? createInstanceSettingsService();

  return {
    getSettings() {
      return loadSettings(instanceSettings);
    },

    async interpret(input: SlackActionInterpreterInput): Promise<SlackControlInterpreterResult> {
      const settings = loadSettings(instanceSettings);
      if (!settings.enabled) {
        return buildClarifyResult(
          "Slack control interpretation is disabled for this instance.",
          "slack_interpreter_disabled",
        );
      }

      const prompt = renderPrompt(input, settings.contextLimit);
      const result = await runCodex({
        runId: `slack-interpreter-${randomUUID()}`,
        agent: {
          id: "slack-control",
          companyId: input.message.companyId,
          name: "Slack Control Interpreter",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          cwd: settings.workdir,
          model: settings.model,
          modelReasoningEffort: "low",
          timeoutSec: settings.timeoutSec,
          injectHeartbeatBrief: false,
          promptTemplate: prompt,
          extraArgs: [
            "--skip-git-repo-check",
            ...(settings.profile ? ["--profile", settings.profile] : []),
          ],
        },
        context: {
          source: "slack_control",
          slackMessageContext: input.message,
        },
        authToken: undefined,
        onLog: async () => {},
      });

      if (result.timedOut) {
        return buildClarifyResult(
          "I could not finish interpreting that Slack request in time. Please try again with a shorter instruction.",
          "slack_interpreter_timed_out",
        );
      }

      if ((result.exitCode ?? 0) !== 0) {
        return buildClarifyResult(
          "I could not interpret that Slack request reliably. Please rephrase it more explicitly.",
          result.errorMessage ?? "slack_interpreter_failed",
        );
      }

      const stdout = typeof result.resultJson?.stdout === "string" ? result.resultJson.stdout : "";
      const summary = typeof result.summary === "string" ? result.summary : "";
      try {
        return parseInterpreterResult(summary || stdout);
      } catch (error) {
        return buildClarifyResult(
          "I could not interpret that Slack request reliably. Please rephrase it with the target issue or assignee.",
          error instanceof Error ? error.message : "invalid_slack_interpreter_output",
        );
      }
    },
  };
}
