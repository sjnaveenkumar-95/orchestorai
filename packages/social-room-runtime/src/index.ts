import type { CompanyChatCompletionAssessment, CompanyChatTopic } from "@orchestorai/shared";
import { normalizeAgentUrlKey } from "@orchestorai/shared";

export const SOCIAL_ROOM_PROMPT_FILE_NAMES = {
  system: "SYSTEM.md",
  agents: "AGENTS.md",
  soul: "SOUL.md",
} as const;

export const DEFAULT_SOCIAL_ROOM_TOPICS: CompanyChatTopic[] = [
  {
    slug: "breakroom-banter",
    label: "Breakroom banter",
    description: "Casual coffee-break talk, jokes, side stories, and harmless nonsense.",
    autonomousAllowed: true,
    internetAllowed: true,
  },
  {
    slug: "industry-news",
    label: "Industry news",
    description: "News, launches, trends, and interesting things happening on the internet.",
    autonomousAllowed: true,
    internetAllowed: true,
  },
  {
    slug: "tech-rants",
    label: "Tech rants",
    description: "Mild complaining about tools, process, meetings, bugs, and day-to-day work friction.",
    autonomousAllowed: true,
    internetAllowed: true,
  },
  {
    slug: "workplace-gossip",
    label: "Workplace gossip",
    description: "Light gossip and office chatter without abusive or targeted harassment.",
    autonomousAllowed: true,
    internetAllowed: true,
  },
  {
    slug: "knowledge-swap",
    label: "Knowledge swap",
    description: "Interesting facts, explainers, trivia, and shared learning.",
    autonomousAllowed: true,
    internetAllowed: true,
  },
];

export const DEFAULT_SOCIAL_ROOM_INITIAL_WAVE_TARGET = 3;
export const DEFAULT_SOCIAL_ROOM_FOLLOW_ON_TARGET = 2;
export const DEFAULT_SOCIAL_ROOM_FOLLOW_ON_DEBOUNCE_MS = 8_000;
export const DEFAULT_SOCIAL_ROOM_MAX_CONSECUTIVE_AGENT_MESSAGES = 6;
export const DEFAULT_SOCIAL_ROOM_THREAD_EXPIRY_MINUTES = 60;

export interface SocialRoomPromptPackContents {
  system: string;
  agents: string;
  soul: string;
}

export interface SocialRoomThreadMessageForAssessment {
  authorType: "user" | "agent" | "system";
  text: string;
}

export interface SocialRoomReplayMessageCandidate {
  id: string;
  authorAgentId: string | null;
  text: string;
  createdAt: Date;
}

export interface SocialRoomIncomingWakePlanInput {
  authorType: "user" | "agent" | "system";
  threadMessageCount: number;
  initialWaveTarget?: number;
}

export interface SocialRoomIncomingWakePlan {
  shouldWake: boolean;
  reason: string | null;
  mode: SocialSpeakerSelectionMode | null;
  maxSelections: number;
}

export interface SocialRoomOverlaySourceFile {
  label: string;
  path: string | null;
  content: string | null;
}

export type SocialSpeakerSelectionMode = "initial_wave" | "follow_on" | "autonomous_start";

export interface SocialSpeakerCandidate {
  id: string;
  name: string;
  role: string | null;
  title: string | null;
  capabilities: string | null;
  personaDigest: string;
  lastParticipatedAt: Date | null;
}

export interface SocialSpeakerCandidateWithScore extends SocialSpeakerCandidate {
  relevanceScore: number;
  spokeRecently: boolean;
}

export interface SocialSpeakerShortlistInput {
  maxCandidates: number;
  recentConversationText: string;
  candidates: SocialSpeakerCandidate[];
  recentSpeakerAgentIds?: string[];
  preferredAgentIds?: string[];
}

export interface SocialSpeakerShortlist {
  candidates: SocialSpeakerCandidateWithScore[];
  cameoCandidateIds: string[];
}

export interface SocialSpeakerSelectionDecision {
  selectedAgentIds: string[];
  stop: boolean;
  allowImmediateRepeat: boolean;
  summary: string;
}

export interface ValidateSocialSpeakerSelectionDecisionInput {
  mode: SocialSpeakerSelectionMode;
  maxSelections: number;
  candidateIds: Set<string>;
  decision: SocialSpeakerSelectionDecision;
  fallbackDecision: SocialSpeakerSelectionDecision;
  immediatePreviousSpeakerAgentId?: string | null;
  cameoCandidateIds: Set<string>;
}

export interface ValidatedSocialSpeakerSelectionDecision extends SocialSpeakerSelectionDecision {
  isUsable: boolean;
  invalidReason: string | null;
}

export interface ComposeSocialRoomInstructionsInput {
  baseFiles: {
    agents?: SocialRoomOverlaySourceFile | null;
    soul?: SocialRoomOverlaySourceFile | null;
    heartbeat?: SocialRoomOverlaySourceFile | null;
    tools?: SocialRoomOverlaySourceFile | null;
  };
  roomFiles: {
    system: SocialRoomOverlaySourceFile;
    agents: SocialRoomOverlaySourceFile;
    soul: SocialRoomOverlaySourceFile;
  };
  contextBrief: string;
}

const TOKEN_PATTERN = /[a-z0-9]+/g;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "any",
  "are",
  "around",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
  "do",
  "for",
  "from",
  "get",
  "got",
  "have",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "latest",
  "me",
  "more",
  "need",
  "new",
  "of",
  "on",
  "or",
  "our",
  "out",
  "should",
  "so",
  "talk",
  "that",
  "the",
  "their",
  "them",
  "there",
  "they",
  "this",
  "through",
  "to",
  "up",
  "update",
  "we",
  "what",
  "when",
  "with",
]);

function tokenizeText(value: string): string[] {
  const normalized = value.toLowerCase().match(TOKEN_PATTERN) ?? [];
  return normalized.filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function uniqueTokens(value: string): Set<string> {
  return new Set(tokenizeText(value));
}

function overlapScore(left: Set<string>, right: Set<string>) {
  let score = 0;
  for (const token of left) {
    if (right.has(token)) score += 1;
  }
  return score;
}

function participationTimestamp(value: Date | null) {
  return value?.getTime() ?? 0;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compareCandidates(
  left: SocialSpeakerCandidateWithScore,
  right: SocialSpeakerCandidateWithScore,
) {
  if (left.relevanceScore !== right.relevanceScore) {
    return right.relevanceScore - left.relevanceScore;
  }
  if (left.spokeRecently !== right.spokeRecently) {
    return left.spokeRecently ? 1 : -1;
  }
  const leftAt = participationTimestamp(left.lastParticipatedAt);
  const rightAt = participationTimestamp(right.lastParticipatedAt);
  if (leftAt !== rightAt) return leftAt - rightAt;
  return left.name.localeCompare(right.name);
}

function computeCandidateRelevanceScore(
  conversationTokens: Set<string>,
  candidate: SocialSpeakerCandidate,
) {
  const roleTokens = uniqueTokens(candidate.role ?? "");
  const titleTokens = uniqueTokens(candidate.title ?? "");
  const capabilityTokens = uniqueTokens(candidate.capabilities ?? "");
  const digestTokens = uniqueTokens(candidate.personaDigest);

  const rawScore =
    overlapScore(conversationTokens, roleTokens) * 2 +
    overlapScore(conversationTokens, titleTokens) * 3 +
    overlapScore(conversationTokens, capabilityTokens) * 3 +
    overlapScore(conversationTokens, digestTokens);

  return rawScore;
}

export function buildDefaultSocialRoomPromptPack(companyName?: string | null): SocialRoomPromptPackContents {
  const companyLabel = companyName?.trim() || "the company";
  return {
    system: [
      "# Social Room System",
      "",
      `This room is the shared social channel for ${companyLabel}.`,
      "Treat it like a coffee-break, after-hours, or hallway conversation space.",
      "",
      "Hard rules:",
      "- This room is for general discussion only. Do not create tasks, approvals, or backlog work from chat.",
      "- Use one root Slack thread per discussion. Keep replies inside the originating thread.",
      "- Human users may always start new root threads, even if the room is already busy.",
      "- Autonomous agent-started discussions are capped and may only start after room inactivity plus a completed previous thread.",
      "- Internet/news access is allowed by default for social-room topics.",
      "- Keep the tone casual, funny, opinionated, and human, but never abusive, threatening, sexually explicit, or hateful.",
      "- Complaining, venting, gossip, and jokes are allowed, but targeted humiliation, slurs, or harassment are not.",
      "- Keep replies short. Usually 1 to 3 short sentences is enough.",
      "- Add a fresh angle instead of repeating what another agent already said.",
      "- If your point is already covered, prefer a reaction over another full reply.",
    ].join("\n"),
    agents: [
      "# Social Room Agent Policy",
      "",
      "For `company_chat_*` wake reasons, social participation is explicitly in scope even if your base work persona is assignment-driven.",
      "Do not exit just because you have no assigned task when this run is for the social room.",
      "",
      "Behavior guidelines:",
      "- Sound like yourself, not like a flattened assistant persona.",
      "- Keep role flavor from your base agent home. A QA engineer, CTO, PM, CEO, and analyst should not all speak the same way.",
      "- It is fine to joke, gossip lightly, complain about work, managers, meetings, or colleagues, and riff on random topics.",
      "- Do not turn casual chat into action items or operational commitments unless a human explicitly asks for that elsewhere.",
      "- Do not write durable memory or notes for casual banter, gossip, or venting by default.",
      "- If you use the internet, bring back short, relevant takeaways instead of dumping raw search output.",
      "- Do not echo the same acknowledgment or punchline another agent already used.",
      "- If you are replying, make your contribution distinct, compact, and worth adding.",
    ].join("\n"),
    soul: [
      "# Social Room Soul",
      "",
      "This is breakroom energy.",
      "Talk like real people hanging around after standup, waiting for coffee, or complaining about a bizarre meeting.",
      "Be witty, nosy, lightly opinionated, occasionally dramatic, and socially alive.",
      "Preserve your own personality and professional lens while loosening the stiff task-execution tone.",
      "A little gossip, side-eye, sarcasm, or gentle roasting is fine. Cruelty is not.",
      "Favor crisp, natural lines over polished mini-essays.",
    ].join("\n"),
  };
}

export function resolveSocialRoomIncomingWakePlan(
  input: SocialRoomIncomingWakePlanInput,
): SocialRoomIncomingWakePlan {
  const isThreadStart = input.threadMessageCount <= 1;
  if (isThreadStart) {
    return {
      shouldWake: true,
      reason: "company_chat_thread_opened",
      mode: "initial_wave",
      maxSelections: 1,
    };
  }

  if (input.authorType === "agent") {
    return {
      shouldWake: false,
      reason: null,
      mode: null,
      maxSelections: 0,
    };
  }

  return {
    shouldWake: true,
    reason: input.authorType === "user" ? "company_chat_human_post" : "company_chat_system_post",
    mode: "initial_wave",
    maxSelections: input.initialWaveTarget ?? DEFAULT_SOCIAL_ROOM_INITIAL_WAVE_TARGET,
  };
}

export function shortlistSocialSpeakerCandidates(
  input: SocialSpeakerShortlistInput,
): SocialSpeakerShortlist {
  const conversationTokens = uniqueTokens(input.recentConversationText);
  const recentSpeakerIds = new Set(input.recentSpeakerAgentIds ?? []);
  const preferredAgentIds = new Set(input.preferredAgentIds ?? []);

  const scored = input.candidates
    .map((candidate) => {
      const rawScore = computeCandidateRelevanceScore(conversationTokens, candidate);
      const recentPenalty = recentSpeakerIds.has(candidate.id) ? 3 : 0;
      return {
        ...candidate,
        relevanceScore: Math.max(0, rawScore - recentPenalty),
        spokeRecently: recentSpeakerIds.has(candidate.id),
      } satisfies SocialSpeakerCandidateWithScore;
    })
    .sort(compareCandidates);

  if (preferredAgentIds.size > 0) {
    scored.sort((left, right) => {
      const leftPreferred = preferredAgentIds.has(left.id);
      const rightPreferred = preferredAgentIds.has(right.id);
      if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1;
      return 0;
    });
  }

  const relevant = scored.filter((candidate) => candidate.relevanceScore > 0);
  const adjacent = scored.filter((candidate) => candidate.relevanceScore === 0);
  const maxCandidates = Math.max(1, input.maxCandidates);

  const shortlist: SocialSpeakerCandidateWithScore[] = [];
  const cameoCandidateIds: string[] = [];

  for (const candidate of relevant) {
    if (shortlist.length >= Math.max(0, maxCandidates - 1)) break;
    shortlist.push(candidate);
  }

  const cameo = adjacent[0] ?? null;
  if (cameo && shortlist.length < maxCandidates) {
    shortlist.push(cameo);
    cameoCandidateIds.push(cameo.id);
  }

  for (const candidate of relevant) {
    if (shortlist.length >= maxCandidates) break;
    if (shortlist.some((entry) => entry.id === candidate.id)) continue;
    shortlist.push(candidate);
  }

  for (const candidate of adjacent.slice(cameo ? 1 : 0)) {
    if (shortlist.length >= maxCandidates) break;
    shortlist.push(candidate);
  }

  return {
    candidates: shortlist,
    cameoCandidateIds,
  };
}

export function classifySocialRoomThreadCompletion(
  messages: SocialRoomThreadMessageForAssessment[],
): CompanyChatCompletionAssessment {
  const normalized = messages
    .map((message) => message.text.trim().toLowerCase())
    .filter((message) => message.length > 0);
  if (normalized.length === 0) return "unclear";

  const recent = normalized.slice(-3);
  const combinedRecent = recent.join(" ");

  const ongoingPatterns = [
    /\?$/,
    /\bwhat do you think\b/,
    /\banyone else\b/,
    /\bshould we\b/,
    /\bcan we\b/,
    /\bstill\b/,
    /\bcontinue\b/,
    /\bfollow up\b/,
    /\bnext time\b/,
  ];
  if (recent.some((message) => ongoingPatterns.some((pattern) => pattern.test(message)))) {
    return "ongoing";
  }

  const donePatterns = [
    /\bthat'?s it\b/,
    /\bcall it\b/,
    /\bwrap(ped)? up\b/,
    /\bwe'?re done\b/,
    /\bdone here\b/,
    /\bmoving on\b/,
    /\bgood place to stop\b/,
    /\bend of thread\b/,
  ];
  if (donePatterns.some((pattern) => pattern.test(combinedRecent))) {
    return "done";
  }

  return "unclear";
}

export function shouldAutoExpireSocialRoomThread(input: {
  assessment: CompanyChatCompletionAssessment | null;
  lastActivityAt: Date | null;
  now: Date;
  expiryMinutes?: number;
}) {
  if (input.assessment === "done") return false;
  if (!input.lastActivityAt) return false;
  const expiryMinutes = input.expiryMinutes ?? DEFAULT_SOCIAL_ROOM_THREAD_EXPIRY_MINUTES;
  const staleMs = expiryMinutes * 60 * 1000;
  return input.now.getTime() - input.lastActivityAt.getTime() >= staleMs;
}

export function findSocialRoomReplayMessageForAgentRun(input: {
  messages: SocialRoomReplayMessageCandidate[];
  agentId: string;
  text: string;
  runStartedAt: Date;
}) {
  return (
    [...input.messages]
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .find(
        (message) =>
          message.authorAgentId === input.agentId &&
          message.text === input.text &&
          message.createdAt.getTime() >= input.runStartedAt.getTime(),
      ) ?? null
  );
}

export function extractMentionedSocialSpeakerAgentIds(input: {
  text: string;
  candidates: Array<Pick<SocialSpeakerCandidate, "id" | "name" | "title">>;
}) {
  const trimmed = input.text.trim();
  if (!trimmed) return [];

  const normalizedText = trimmed.toLowerCase();
  const firstNameCounts = new Map<string, number>();
  for (const candidate of input.candidates) {
    const firstName = candidate.name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (!firstName) continue;
    firstNameCounts.set(firstName, (firstNameCounts.get(firstName) ?? 0) + 1);
  }

  const mentioned: string[] = [];
  for (const candidate of input.candidates) {
    const aliases = new Set<string>();
    const slug = normalizeAgentUrlKey(candidate.name);
    const fullName = candidate.name.trim().toLowerCase();
    const firstName = candidate.name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

    if (slug) aliases.add(`@${slug}`);
    if (fullName) aliases.add(fullName);
    if (firstName && (firstNameCounts.get(firstName) ?? 0) === 1) {
      aliases.add(firstName);
    }

    for (const alias of aliases) {
      const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(alias)}(?=$|[^a-z0-9])`, "i");
      if (pattern.test(normalizedText)) {
        mentioned.push(candidate.id);
        break;
      }
    }
  }

  return mentioned;
}

export function evaluateAutonomousStartEligibility(input: {
  autonomousStartEnabled: boolean;
  activeAutonomousThreads: number;
  maxAutonomousThreads: number;
  idleThresholdHours: number;
  lastRoomActivityAt: Date | null;
  now: Date;
  lastThreadAssessment: CompanyChatCompletionAssessment | null;
}) {
  if (!input.autonomousStartEnabled) {
    return { allowed: false, reason: "autonomous_disabled" as const };
  }
  if (input.activeAutonomousThreads >= input.maxAutonomousThreads) {
    return { allowed: false, reason: "autonomous_cap_reached" as const };
  }
  if (!input.lastRoomActivityAt) {
    return { allowed: true, reason: "room_empty" as const };
  }

  const idleMs = input.now.getTime() - input.lastRoomActivityAt.getTime();
  if (idleMs < input.idleThresholdHours * 60 * 60 * 1000) {
    return { allowed: false, reason: "room_not_idle" as const };
  }
  if (!input.lastThreadAssessment || input.lastThreadAssessment !== "done") {
    return { allowed: false, reason: "last_thread_not_done" as const };
  }
  return { allowed: true, reason: "idle_and_done" as const };
}

export function validateSocialSpeakerSelectionDecision(
  input: ValidateSocialSpeakerSelectionDecisionInput,
): ValidatedSocialSpeakerSelectionDecision {
  const selectedAgentIds: string[] = [];
  for (const agentId of input.decision.selectedAgentIds) {
    if (!input.candidateIds.has(agentId)) continue;
    if (selectedAgentIds.includes(agentId)) continue;
    selectedAgentIds.push(agentId);
    if (selectedAgentIds.length >= input.maxSelections) break;
  }

  let invalidReason: string | null = null;

  if (
    input.immediatePreviousSpeakerAgentId &&
    !input.decision.allowImmediateRepeat &&
    selectedAgentIds[0] === input.immediatePreviousSpeakerAgentId
  ) {
    selectedAgentIds.shift();
    invalidReason = "immediate_repeat_blocked";
  }

  if (input.mode === "initial_wave" && selectedAgentIds.length > 1 && input.cameoCandidateIds.size > 0) {
    let cameoCount = 0;
    const filtered = selectedAgentIds.filter((agentId) => {
      if (!input.cameoCandidateIds.has(agentId)) return true;
      cameoCount += 1;
      return cameoCount <= 1;
    });
    selectedAgentIds.splice(0, selectedAgentIds.length, ...filtered);
  }

  const stop = input.mode === "follow_on" && selectedAgentIds.length === 0
    ? true
    : input.decision.stop;

  const isUsable = selectedAgentIds.length > 0 || stop;

  return {
    selectedAgentIds: isUsable ? selectedAgentIds : input.fallbackDecision.selectedAgentIds,
    stop: isUsable ? stop : input.fallbackDecision.stop,
    allowImmediateRepeat: input.decision.allowImmediateRepeat,
    summary: input.decision.summary.trim() || input.fallbackDecision.summary,
    isUsable,
    invalidReason,
  };
}

export function countConsecutiveAgentMessages(
  messages: SocialRoomThreadMessageForAssessment[],
) {
  let count = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.authorType !== "agent") break;
    count += 1;
  }
  return count;
}

function renderSourceSection(file: SocialRoomOverlaySourceFile | null | undefined): string | null {
  if (!file) return null;
  const content = file.content?.trim();
  if (!content) return null;
  const sourceLine = file.path ? `Source: ${file.path}` : "Source: inline";
  return [`## ${file.label}`, sourceLine, "", content].join("\n");
}

export function composeSocialRoomInstructions(input: ComposeSocialRoomInstructionsInput): string {
  const sections = [
    renderSourceSection(input.roomFiles.system),
    renderSourceSection(input.baseFiles.agents ?? null),
    renderSourceSection(input.baseFiles.soul ?? null),
    renderSourceSection(input.baseFiles.heartbeat ?? null),
    renderSourceSection(input.baseFiles.tools ?? null),
    renderSourceSection(input.roomFiles.agents),
    renderSourceSection(input.roomFiles.soul),
    input.contextBrief.trim().length > 0
      ? ["## Social Room Context", "", input.contextBrief.trim()].join("\n")
      : null,
  ].filter((section): section is string => Boolean(section));

  return `${sections.join("\n\n")}\n`;
}
