import crypto from "node:crypto";

export interface SlackMentionEvent {
  type: "app_mention";
  channel: string;
  text: string;
  ts: string;
  thread_ts?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
}

export interface SlackEventEnvelope {
  type: string;
  challenge?: string;
  event_id?: string;
  event?: SlackMentionEvent;
}

export interface SlackSlashCommandPayload {
  command: string;
  text: string;
  channelId: string;
  userId: string;
  responseUrl: string;
}

export class SlackApiError extends Error {
  constructor(
    message: string,
    public readonly responseBody: unknown,
  ) {
    super(message);
    this.name = "SlackApiError";
  }
}

function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifySlackSignature(params: {
  signingSecret: string;
  rawBody: string;
  timestampHeader: string | undefined;
  signatureHeader: string | undefined;
}): boolean {
  const timestamp = Number.parseInt(params.timestampHeader ?? "", 10);
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (ageSeconds > 60 * 5) {
    return false;
  }

  const base = `v0:${timestamp}:${params.rawBody}`;
  const digest = `v0=${crypto.createHmac("sha256", params.signingSecret).update(base).digest("hex")}`;
  return safeCompare(digest, params.signatureHeader ?? "");
}

export function stripLeadingSlackMentions(text: string): string {
  return text.replace(/^(?:<@[A-Z0-9]+>\s*)+/i, "").trim();
}

export function parseSlackSlashCommandPayload(rawBody: string): SlackSlashCommandPayload {
  const params = new URLSearchParams(rawBody);
  return {
    command: params.get("command") ?? "",
    text: params.get("text") ?? "",
    channelId: params.get("channel_id") ?? "",
    userId: params.get("user_id") ?? "",
    responseUrl: params.get("response_url") ?? "",
  };
}

export class SlackClient {
  constructor(private readonly token: string) {}

  private async apiCall<T extends { ok: boolean; error?: string }>(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
    });

    const json = (await response.json()) as T;
    if (!response.ok || !json.ok) {
      throw new SlackApiError(`Slack API call failed: ${method} -> ${json.error ?? response.status}`, json);
    }
    return json;
  }

  async postMessage(input: {
    channel: string;
    text: string;
    threadTs?: string;
  }): Promise<{ channel: string; ts: string; threadTs: string }> {
    const json = await this.apiCall<{
      ok: boolean;
      error?: string;
      channel: string;
      ts: string;
      message?: { thread_ts?: string };
    }>("chat.postMessage", {
      channel: input.channel,
      text: input.text,
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
    });

    return {
      channel: json.channel,
      ts: json.ts,
      threadTs: json.message?.thread_ts ?? input.threadTs ?? json.ts,
    };
  }
}
