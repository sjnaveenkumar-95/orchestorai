const SLACK_CHANNEL_TRIM_RE = /^-+|-+$/g;
const SLACK_CHANNEL_DELIM_RE = /[^a-z0-9]+/g;

function truncateSlackChannelName(value: string, maxLength = 80) {
  return value.slice(0, maxLength).replace(/-+$/g, "");
}

export function normalizeSlackChannelName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(SLACK_CHANNEL_DELIM_RE, "-")
    .replace(SLACK_CHANNEL_TRIM_RE, "")
    .replace(/-+/g, "-");

  if (normalized.length === 0) return null;

  const truncated = truncateSlackChannelName(normalized);
  return truncated.length > 0 ? truncated : null;
}

export function buildProjectSlackChannelName(
  companyName: string | null | undefined,
  projectName: string | null | undefined,
): string {
  const companySegment = normalizeSlackChannelName(companyName) ?? "company";
  const projectSegment = normalizeSlackChannelName(projectName) ?? "project";
  return truncateSlackChannelName(`${companySegment}-${projectSegment}`) || "project";
}
