import "dotenv/config";
import express, { type Request, type Response } from "express";
import { loadConfig } from "./config.js";
import { parseCommandText, helpText, type ParsedCommand } from "./commands.js";
import { FileStateStore } from "./state.js";
import { OrchestorAIApiError, OrchestorAIClient, type OrchestorAIIssue } from "./orchestorai.js";
import {
  parseSlackSlashCommandPayload,
  SlackApiError,
  SlackClient,
  stripLeadingSlackMentions,
  verifySlackSignature,
  type SlackEventEnvelope,
  type SlackMentionEvent,
  type SlackSlashCommandPayload,
} from "./slack.js";

const config = loadConfig();
const app = express();
const state = new FileStateStore(config.stateFile);
const orchestorai = new OrchestorAIClient(config.orchestoraiApiUrl, config.orchestoraiApiToken);
const slack = new SlackClient(config.slackBotToken);

app.disable("x-powered-by");

function parseBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match?.[1]?.trim() ?? null;
}

function issueDisplay(issue: Pick<OrchestorAIIssue, "id" | "identifier" | "title">): string {
  const ref = issue.identifier ?? issue.id;
  return `${ref} - ${issue.title}`;
}

function normalizeRawBody(body: unknown): string {
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  if (typeof body === "string") return body;
  return "";
}

function isThreadReply(event: SlackMentionEvent): boolean {
  return Boolean(event.thread_ts && event.thread_ts !== event.ts);
}

function buildIssueDescription(input: {
  description: string | null;
  sourceText: string;
  channelId: string;
  threadTs: string;
  slackUserId: string | null;
}): string {
  const lines = [
    input.description?.trim() || null,
    "_Created from Slack_",
    `Slack user: ${input.slackUserId ? `<@${input.slackUserId}>` : "unknown"}`,
    `Slack channel: ${input.channelId}`,
    input.threadTs ? `Slack thread: ${input.threadTs}` : null,
    "",
    "Original Slack text:",
    input.sourceText.trim(),
  ].filter((line): line is string => Boolean(line));
  return lines.join("\n");
}

function buildCommentBody(input: {
  text: string;
  channelId: string;
  threadTs: string;
  slackUserId: string | null;
}): string {
  return [
    `Slack comment from ${input.slackUserId ? `<@${input.slackUserId}>` : "unknown-user"}`,
    `Channel: ${input.channelId}`,
    `Thread: ${input.threadTs}`,
    "",
    input.text.trim(),
  ].join("\n");
}

async function replyInSlack(channel: string, threadTs: string, text: string): Promise<void> {
  await slack.postMessage({ channel, threadTs, text });
}

function explainBridgeError(error: unknown): string {
  if (error instanceof OrchestorAIApiError) {
    return `OrchestorAI error (${error.status}): ${error.responseBody || error.message}`;
  }
  if (error instanceof SlackApiError) {
    return `Slack error: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

async function resolveIssueForStatus(input: {
  command: Extract<ParsedCommand, { kind: "status" }>;
  channelId: string;
  threadTs: string;
}): Promise<OrchestorAIIssue | null> {
  if (input.command.issueRef) {
    return orchestorai.getIssue(input.command.issueRef);
  }
  const link = await state.getThreadLink(input.channelId, input.threadTs);
  if (!link) {
    return null;
  }
  return orchestorai.getIssue(link.issueId);
}

async function createIssueFromSlack(input: {
  channelId: string;
  threadTs: string;
  slackUserId: string | null;
  sourceText: string;
  title: string;
  description: string | null;
  companyId: string | null;
}): Promise<OrchestorAIIssue> {
  const companyId = input.companyId ?? config.defaultCompanyId;
  if (!companyId) {
    throw new Error("No OrchestorAI company configured. Set ORCHESTORAI_DEFAULT_COMPANY_ID or use --company <company-id>.");
  }

  const issue = await orchestorai.createIssue({
    companyId,
    title: input.title,
    description: buildIssueDescription({
      description: input.description,
      sourceText: input.sourceText,
      channelId: input.channelId,
      threadTs: input.threadTs,
      slackUserId: input.slackUserId,
    }),
  });

  if (input.threadTs.trim()) {
    await state.upsertThreadLink({
      channelId: input.channelId,
      threadTs: input.threadTs,
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      issueTitle: issue.title,
      companyId: issue.companyId,
    });
  }

  return issue;
}

async function addSlackCommentToIssue(input: {
  channelId: string;
  threadTs: string;
  slackUserId: string | null;
  text: string;
}): Promise<OrchestorAIIssue | null> {
  const link = await state.getThreadLink(input.channelId, input.threadTs);
  if (!link) {
    return null;
  }

  await orchestorai.addIssueComment(
    link.issueId,
    buildCommentBody({
      text: input.text,
      channelId: input.channelId,
      threadTs: input.threadTs,
      slackUserId: input.slackUserId,
    }),
  );

  return orchestorai.getIssue(link.issueId);
}

async function handleMentionEvent(event: SlackMentionEvent): Promise<void> {
  if (event.bot_id || event.subtype) {
    return;
  }

  const threadTs = event.thread_ts ?? event.ts;
  const strippedText = stripLeadingSlackMentions(event.text ?? "");
  const command = parseCommandText(strippedText);
  const linkedThread = await state.getThreadLink(event.channel, threadTs);
  const replyTarget = threadTs;

  if (command.kind === "help") {
    await replyInSlack(event.channel, replyTarget, helpText());
    return;
  }

  if (command.kind === "status") {
    const issue = await resolveIssueForStatus({
      command,
      channelId: event.channel,
      threadTs,
    });
    if (!issue) {
      await replyInSlack(
        event.channel,
        replyTarget,
        "This thread is not linked to a OrchestorAI issue yet. Use `@orchestorai create ...` or `@orchestorai link PAP-123`.",
      );
      return;
    }

    await replyInSlack(
      event.channel,
      replyTarget,
      `Linked OrchestorAI issue: *${issueDisplay(issue)}*\nStatus: \`${issue.status}\`\nPriority: \`${issue.priority}\``,
    );
    return;
  }

  if (command.kind === "link") {
    const issue = await orchestorai.getIssue(command.issueRef);
    await state.upsertThreadLink({
      channelId: event.channel,
      threadTs,
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      issueTitle: issue.title,
      companyId: issue.companyId,
    });
    await replyInSlack(
      event.channel,
      replyTarget,
      `Linked this Slack thread to OrchestorAI issue *${issueDisplay(issue)}*. Mention me here to append comments.`,
    );
    return;
  }

  if (command.kind === "comment" || (linkedThread && command.kind === "freeform")) {
    const body = command.kind === "comment" ? command.body : command.text;
    const issue = await addSlackCommentToIssue({
      channelId: event.channel,
      threadTs,
      slackUserId: event.user ?? null,
      text: body,
    });
    if (!issue) {
      await replyInSlack(
        event.channel,
        replyTarget,
        "This thread is not linked to a OrchestorAI issue yet. Use `@orchestorai create ...` or `@orchestorai link PAP-123` first.",
      );
      return;
    }
    await replyInSlack(event.channel, replyTarget, `Added comment to *${issueDisplay(issue)}*.`);
    return;
  }

  const explicitCreate = command.kind === "create";
  const implicitCreate = command.kind === "freeform" && !linkedThread && !isThreadReply(event);
  if (explicitCreate || implicitCreate) {
    const title = command.kind === "create" ? command.title : command.text;
    const description = command.kind === "create" ? command.description : null;
    const companyId = command.kind === "create" ? command.companyId : null;
    const issue = await createIssueFromSlack({
      channelId: event.channel,
      threadTs,
      slackUserId: event.user ?? null,
      sourceText: strippedText,
      title,
      description,
      companyId,
    });
    await replyInSlack(
      event.channel,
      replyTarget,
      `Created OrchestorAI issue *${issueDisplay(issue)}* and linked this thread.\nMention me in this thread to append more comments.`,
    );
    return;
  }

  if (isThreadReply(event) && !linkedThread) {
    await replyInSlack(
      event.channel,
      replyTarget,
      "This thread is not linked to a OrchestorAI issue yet. Use `@orchestorai link PAP-123` or `@orchestorai create ...`.",
    );
    return;
  }

  await replyInSlack(event.channel, replyTarget, helpText());
}

async function handleSlashCommand(payload: SlackSlashCommandPayload): Promise<{
  response_type: "ephemeral";
  text: string;
}> {
  const command = parseCommandText(payload.text);

  if (command.kind === "help") {
    return { response_type: "ephemeral", text: helpText() };
  }

  if (command.kind !== "create" && command.kind !== "freeform") {
    return {
      response_type: "ephemeral",
      text: "This minimal slash command only creates issues. Use `@orchestorai link ...`, `@orchestorai status`, or mention the bot inside a thread for comment sync.",
    };
  }

  const title = command.kind === "create" ? command.title : command.text;
  const description = command.kind === "create" ? command.description : null;
  const companyId = command.kind === "create" ? command.companyId : null;
  const issue = await createIssueFromSlack({
    channelId: payload.channelId,
    threadTs: "",
    slackUserId: payload.userId,
    sourceText: payload.text,
    title,
    description,
    companyId,
  });

  const rootPost = await slack.postMessage({
    channel: payload.channelId,
    text: `OrchestorAI issue *${issueDisplay(issue)}* created by <@${payload.userId}>.\nReply in this thread and mention me to sync comments.`,
  });

  await state.upsertThreadLink({
    channelId: rootPost.channel,
    threadTs: rootPost.threadTs,
    issueId: issue.id,
    issueIdentifier: issue.identifier,
    issueTitle: issue.title,
    companyId: issue.companyId,
  });

  return {
    response_type: "ephemeral",
    text: `Created *${issueDisplay(issue)}* and started a Slack thread in this channel.`,
  };
}

async function handleOutboundMessage(body: unknown): Promise<{
  ok: true;
  channelId: string;
  ts: string;
  threadTs: string;
}> {
  const input = (body ?? {}) as Record<string, unknown>;
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) {
    throw new Error("text is required");
  }

  let channelId = typeof input.channelId === "string" ? input.channelId.trim() : "";
  let threadTs = typeof input.threadTs === "string" ? input.threadTs.trim() : "";
  const issueRef =
    typeof input.issueId === "string"
      ? input.issueId.trim()
      : typeof input.issueIdentifier === "string"
        ? input.issueIdentifier.trim()
        : "";

  if ((!channelId || !threadTs) && issueRef) {
    const link = await state.getLatestLinkByIssue(issueRef);
    if (link) {
      channelId = channelId || link.channelId;
      threadTs = threadTs || link.threadTs;
    }
  }

  if (!channelId) {
    throw new Error("channelId is required unless issueId or issueIdentifier resolves to a linked Slack thread");
  }

  const posted = await slack.postMessage({
    channel: channelId,
    threadTs: threadTs || undefined,
    text,
  });

  return {
    ok: true,
    channelId: posted.channel,
    ts: posted.ts,
    threadTs: posted.threadTs,
  };
}

function requireOutboundAuth(req: Request, res: Response): boolean {
  if (!config.outboundToken) {
    return true;
  }

  const provided =
    parseBearerToken(req.header("authorization")) ??
    req.header("x-orchestorai-bridge-token")?.trim() ??
    null;

  if (provided !== config.outboundToken) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  return true;
}

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    bridge: "slack",
    orchestoraiApiUrl: config.orchestoraiApiUrl,
    defaultCompanyId: config.defaultCompanyId,
    stateFile: config.stateFile,
    outboundAuthEnabled: Boolean(config.outboundToken),
  });
});

app.post("/slack/events", express.raw({ type: "application/json" }), async (req, res) => {
  const rawBody = normalizeRawBody(req.body);
  const isValid = verifySlackSignature({
    signingSecret: config.slackSigningSecret,
    rawBody,
    timestampHeader: req.header("x-slack-request-timestamp"),
    signatureHeader: req.header("x-slack-signature"),
  });

  if (!isValid) {
    res.status(401).json({ error: "Invalid Slack signature" });
    return;
  }

  const payload = JSON.parse(rawBody) as SlackEventEnvelope;
  if (payload.type === "url_verification") {
    res.json({ challenge: payload.challenge ?? "" });
    return;
  }

  res.status(200).json({ ok: true });

  if (payload.event?.type === "app_mention") {
    void handleMentionEvent(payload.event).catch((error) => {
      console.error("[slack-bridge] event handler failed:", explainBridgeError(error));
    });
  }
});

app.post("/slack/commands/orchestorai", express.raw({ type: "application/x-www-form-urlencoded" }), async (req, res) => {
  const rawBody = normalizeRawBody(req.body);
  const isValid = verifySlackSignature({
    signingSecret: config.slackSigningSecret,
    rawBody,
    timestampHeader: req.header("x-slack-request-timestamp"),
    signatureHeader: req.header("x-slack-signature"),
  });

  if (!isValid) {
    res.status(401).json({ error: "Invalid Slack signature" });
    return;
  }

  try {
    const payload = parseSlackSlashCommandPayload(rawBody);
    const response = await handleSlashCommand(payload);
    res.json(response);
  } catch (error) {
    console.error("[slack-bridge] slash command failed:", explainBridgeError(error));
    res.json({
      response_type: "ephemeral",
      text: explainBridgeError(error),
    });
  }
});

app.use(express.json());

app.post("/orchestorai/outbound/message", async (req, res) => {
  if (!requireOutboundAuth(req, res)) {
    return;
  }

  try {
    const result = await handleOutboundMessage(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: explainBridgeError(error) });
  }
});

app.listen(config.port, config.host, () => {
  console.log(
    `[slack-bridge] listening on http://${config.host}:${config.port} -> ${config.orchestoraiApiUrl}`,
  );
});
