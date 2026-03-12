export function normalizeChannelType(channelType, channelId = "") {
  if (channelType === "app_home") {
    return "im";
  }
  if (channelType) {
    return channelType;
  }
  if (/^D/i.test(channelId)) {
    return "im";
  }
  if (/^G/i.test(channelId)) {
    return "group";
  }
  if (/^C/i.test(channelId)) {
    return "channel";
  }
  return "channel";
}

export function cleanSlackText(text) {
  return String(text || "")
    .replace(/<@[^>]+>/g, "")
    .trim();
}

export function chunkByLength(text, limit) {
  const normalized = String(text || "");
  if (normalized.length <= limit) {
    return [normalized];
  }
  const chunks = [];
  let current = normalized;
  while (current.length > limit) {
    chunks.push(current.slice(0, limit));
    current = current.slice(limit);
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

export function chunkByNewline(text, limit) {
  const lines = String(text || "").split("\n");
  const chunks = [];
  let current = "";

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current) {
      chunks.push(current);
      current = "";
    }
    if (line.length <= limit) {
      current = line;
      continue;
    }
    chunks.push(...chunkByLength(line, limit));
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : [""];
}

export function chunkText(text, limit = 4000, mode = "length") {
  if (mode === "newline") {
    return chunkByNewline(text, limit);
  }
  return chunkByLength(text, limit);
}

export async function safeAck(ack) {
  if (typeof ack !== "function") {
    return;
  }
  try {
    await ack();
  } catch {
    // Slack Bolt throws if an interaction has already been acknowledged.
  }
}

export function resolveReplyThreadTs(event) {
  return event.thread_ts || event.ts || undefined;
}

export function buildHistoryContext(messages = []) {
  return messages
    .map((message) => {
      const user = message.user || message.bot_id || "unknown";
      const text = String(message.text || "").replace(/\s+/g, " ").trim();
      return `- ${user}: ${text || "(no text)"}`;
    })
    .join("\n");
}
