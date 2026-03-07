export type ParsedCommand =
  | { kind: "help" }
  | { kind: "status"; issueRef: string | null }
  | { kind: "link"; issueRef: string }
  | { kind: "comment"; body: string }
  | { kind: "create"; title: string; description: string | null; companyId: string | null }
  | { kind: "freeform"; text: string };

function extractOption(input: string, optionName: string): { rest: string; value: string | null } {
  const escaped = optionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?:^|\\s)${escaped}\\s+(\\S+)`);
  const match = regex.exec(input);
  if (!match) {
    return { rest: input.trim(), value: null };
  }

  const fullMatch = match[0];
  const start = match.index;
  const end = start + fullMatch.length;
  const prefix = input.slice(0, start).trimEnd();
  const suffix = input.slice(end).trimStart();
  return {
    rest: `${prefix} ${suffix}`.trim(),
    value: match[1] ?? null,
  };
}

function splitTitleAndDescription(input: string): { title: string; description: string | null } {
  const separatorIndex = input.indexOf("::");
  if (separatorIndex === -1) {
    return { title: input.trim(), description: null };
  }
  return {
    title: input.slice(0, separatorIndex).trim(),
    description: input.slice(separatorIndex + 2).trim() || null,
  };
}

export function parseCommandText(input: string): ParsedCommand {
  const text = input.trim();
  if (!text) {
    return { kind: "help" };
  }

  const [verb] = text.split(/\s+/, 1);
  const rest = text.slice(verb.length).trim();

  switch (verb.toLowerCase()) {
    case "help":
      return { kind: "help" };
    case "status":
      return { kind: "status", issueRef: rest || null };
    case "link":
      return rest ? { kind: "link", issueRef: rest } : { kind: "help" };
    case "comment":
      return rest ? { kind: "comment", body: rest } : { kind: "help" };
    case "create": {
      const { rest: createText, value: companyId } = extractOption(rest, "--company");
      const { title, description } = splitTitleAndDescription(createText);
      if (!title) {
        return { kind: "help" };
      }
      return { kind: "create", title, description, companyId };
    }
    default:
      return { kind: "freeform", text };
  }
}

export function helpText(): string {
  return [
    "Paperclip Slack bridge commands:",
    "- create <title>",
    "- create <title> :: <description>",
    "- create <title> --company <company-id>",
    "- link <issue-id-or-identifier>",
    "- status",
    "- comment <text>",
    "",
    "Shortcuts:",
    "- root-channel mention with free text creates an issue",
    "- mentioning the bot in a linked thread adds a Paperclip comment",
  ].join("\n");
}
