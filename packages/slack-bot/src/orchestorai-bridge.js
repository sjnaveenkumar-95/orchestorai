function collapseWhitespace(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripSlackMentions(value) {
  return String(value || "").replace(/<@[^>]+>/g, " ").replace(/[ \t]+/g, " ").trim();
}

function normalizeAgentName(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTriggerMention(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "");
}

function normalizeTriggerMentions(triggerMentions) {
  return uniqueStrings(
    (triggerMentions || [])
      .map((entry) => normalizeTriggerMention(entry))
      .filter(Boolean),
  );
}

function normalizeProjectName(value) {
  return collapseWhitespace(value).toLowerCase();
}

function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

function slugifyLookupValue(value) {
  return collapseWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

export function extractSlackMentionIds(text) {
  const ids = [];
  const source = String(text || "");
  const pattern = /<@([A-Z0-9]+)>/gi;
  for (const match of source.matchAll(pattern)) {
    const id = String(match[1] || "").trim().toUpperCase();
    if (id) {
      ids.push(id);
    }
  }
  return uniqueStrings(ids);
}

export function extractPlainAgentMentions(text) {
  const names = [];
  const source = String(text || "");
  const pattern = /(^|[\s(])@([A-Za-z][A-Za-z0-9._-]{0,79})/g;
  const ignored = new Set(["channel", "here", "everyone"]);
  for (const match of source.matchAll(pattern)) {
    const name = String(match[2] || "").trim();
    if (!name) {
      continue;
    }
    if (ignored.has(name.toLowerCase())) {
      continue;
    }
    names.push(name);
  }
  return uniqueStrings(names);
}

export function extractProjectSelectors(text) {
  const selectors = [];
  const source = String(text || "").replace(/\r/g, "");
  const cleanSelector = (value) =>
    collapseWhitespace(value)
      .replace(/\s+(?:<@[^>]+>|@[A-Za-z][A-Za-z0-9._-]{0,79}|#project\b).*$/i, "")
      .replace(/[.,;:!?]+$/g, "")
      .trim();

  const prefixedPattern = /(?:^|\n)\s*(?:project|proj)\s*:\s*([^\n]+)/gi;
  for (const match of source.matchAll(prefixedPattern)) {
    if (match?.[1]) {
      selectors.push(match[1]);
    }
  }

  const hashPattern = /(?:^|[\s(])#project\s+([^\n]+?)(?=(?:\s(?:<@|@[A-Za-z]|#project)\b|$))/gi;
  for (const match of source.matchAll(hashPattern)) {
    if (match?.[1]) {
      selectors.push(match[1]);
    }
  }

  return uniqueStrings(selectors.map((value) => cleanSelector(value)).filter(Boolean));
}

export function extractIssueIdentifiers(text) {
  const identifiers = [];
  const source = String(text || "");
  const pattern = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/gi;
  for (const match of source.matchAll(pattern)) {
    const identifier = String(match[1] || "").trim().toUpperCase();
    if (identifier) {
      identifiers.push(identifier);
    }
  }
  return uniqueStrings(identifiers);
}

function looksLikeSummaryVerb(text) {
  const source = String(text || "");
  return (
    /\b(summary|summari[sz]e|summarise|recap|overview|brief|details?|status|updates?|list|show|count)\b/i.test(
      source,
    ) ||
    /\bwhat(?:'s| is)\s+(?:the\s+)?(?:status|update|summary)\b/i.test(source) ||
    /\bhow many\s+(?:tickets|issues)\b/i.test(source)
  );
}

export function detectOrchestorAISummaryRequest({ text, mappedIssueIdentifier = "" }) {
  const source = collapseWhitespace(stripSlackMentions(String(text || "")));
  if (!source) {
    return null;
  }

  const normalized = source.toLowerCase();
  const identifiers = extractIssueIdentifiers(source);
  const summaryIntent = looksLikeSummaryVerb(normalized) || /\babout\b/i.test(normalized);
  if (!summaryIntent) {
    return null;
  }

  if (identifiers.length > 0) {
    return {
      kind: "issue",
      issueIdentifiers: identifiers,
      source: "identifier",
    };
  }

  const refersToCurrentIssue =
    /\b(this|that|current)\s+(ticket|issue|thread)\b/i.test(normalized) ||
    /\b(ticket|issue)\s+details\b/i.test(normalized);
  if (mappedIssueIdentifier && refersToCurrentIssue) {
    return {
      kind: "issue",
      issueIdentifiers: [String(mappedIssueIdentifier).trim().toUpperCase()],
      source: "mapped_thread",
    };
  }

  const overviewIntent =
    /\b(tickets|issues|dashboard|board)\b/i.test(normalized) || /\borchestorai\b/i.test(normalized);
  if (!overviewIntent) {
    return null;
  }

  return {
    kind: "overview",
    issueIdentifiers: [],
    source: "overview",
  };
}

export function detectOrchestorAICommentRequest({ text, mappedIssueIdentifier = "" }) {
  const source = collapseWhitespace(stripSlackMentions(String(text || "")));
  if (!source) {
    return null;
  }

  const normalized = source.toLowerCase();
  const mentionsComment = /\bcomments?\b/i.test(normalized);
  const wantsLatest =
    /\b(latest|recent|last|newest|most recent)\b/i.test(normalized) ||
    /\bshow\b/i.test(normalized) ||
    /\bget\b/i.test(normalized) ||
    /\bwhat(?:'s| is)\b/i.test(normalized);

  if (!mentionsComment || !wantsLatest) {
    return null;
  }

  const identifiers = extractIssueIdentifiers(source);
  if (identifiers.length > 0) {
    return {
      kind: "latest_comment",
      issueIdentifiers: identifiers,
      source: "identifier",
    };
  }

  const refersToCurrentIssue =
    /\b(this|that|current)\s+(ticket|issue|thread)\b/i.test(normalized) ||
    /\b(ticket|issue)\s+comments?\b/i.test(normalized);
  if (mappedIssueIdentifier && refersToCurrentIssue) {
    return {
      kind: "latest_comment",
      issueIdentifiers: [String(mappedIssueIdentifier).trim().toUpperCase()],
      source: "mapped_thread",
    };
  }

  return null;
}

function mappingLookupCandidates({ slackMentionIds, plainMentions }) {
  const keys = [];
  for (const id of slackMentionIds || []) {
    keys.push(id, id.toLowerCase(), `<@${id}>`, `<@${id.toLowerCase()}>`, `slack:${id}`, `slack:${id.toLowerCase()}`);
  }
  for (const mention of plainMentions || []) {
    const trimmed = String(mention || "").trim();
    if (!trimmed) {
      continue;
    }
    const lower = trimmed.toLowerCase();
    keys.push(trimmed, lower, `@${trimmed}`, `@${lower}`, `slack:${trimmed}`, `slack:${lower}`);
  }
  return uniqueStrings(keys);
}

function projectLookupCandidates(selectors) {
  const keys = [];
  for (const selector of selectors || []) {
    const trimmed = collapseWhitespace(selector);
    if (!trimmed) {
      continue;
    }
    const lower = trimmed.toLowerCase();
    const slug = slugifyLookupValue(trimmed);
    keys.push(trimmed, lower, `project:${trimmed}`, `project:${lower}`);
    if (slug) {
      keys.push(slug, `project:${slug}`);
    }
  }
  return uniqueStrings(keys);
}

function normalizeMappings(agentMappings) {
  const out = new Map();
  if (!agentMappings || typeof agentMappings !== "object" || Array.isArray(agentMappings)) {
    return out;
  }
  for (const [rawKey, rawValue] of Object.entries(agentMappings)) {
    const key = String(rawKey || "").trim().toLowerCase();
    const value = String(rawValue || "").trim();
    if (!key || !value) {
      continue;
    }
    out.set(key, value);
  }
  return out;
}

function findAgentById(agents, agentId) {
  return (agents || []).find((agent) => String(agent?.id || "") === String(agentId || "")) || null;
}

function findProjectById(projects, projectId) {
  return (projects || []).find((project) => String(project?.id || "") === String(projectId || "")) || null;
}

function readEntityReferenceAliases(entity) {
  const references = asRecord(asRecord(entity?.metadata)?.references);
  if (!references) {
    return [];
  }
  const primaryAlias = slugifyLookupValue(references.primaryAlias);
  const aliases = Array.isArray(references.aliases)
    ? references.aliases.map((entry) => slugifyLookupValue(entry))
    : [];
  return uniqueStrings([primaryAlias, ...aliases].filter(Boolean));
}

export function getPrimaryReferenceAlias(entity) {
  return readEntityReferenceAliases(entity)[0] || "";
}

export function detectTaskRequest({ text, taskPrefix }) {
  const prefix = String(taskPrefix || "task:").trim();
  if (!prefix) {
    return null;
  }

  const source = String(text || "").replace(/\r/g, "");
  const triggerMentions = arguments[0]?.triggerMentions;
  const lines = source.split("\n");
  const leadingLines = [];
  const bodyLines = [];
  let matched = false;
  let normalized = "";

  for (const line of lines) {
    const cleaned = stripLeadingTriggerMentions(
      stripSlackMentions(line).trim(),
      triggerMentions,
    );
    if (!matched) {
      if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
        matched = true;
        normalized = cleaned;
        const firstBodyLine = cleaned.slice(prefix.length).trim();
        if (firstBodyLine) {
          bodyLines.push(firstBodyLine);
        }
        continue;
      }
      if (cleaned) {
        leadingLines.push(cleaned);
      }
      continue;
    }
    if (cleaned) {
      bodyLines.push(cleaned);
    }
  }

  if (!matched) {
    return null;
  }

  return {
    prefix,
    body: bodyLines.join("\n").trim(),
    title: leadingLines[0] || bodyLines[0] || "",
    strippedText: normalized,
  };
}

function stripLeadingTriggerMentions(text, triggerMentions) {
  let remaining = String(text || "").trim();
  const normalizedTriggers = normalizeTriggerMentions(triggerMentions);
  if (!remaining || normalizedTriggers.length === 0) {
    return remaining;
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const trigger of normalizedTriggers) {
      const pattern = new RegExp(`^@${escapeRegex(trigger)}(?:\\s*[:,;-])?\\s*`, "i");
      const next = remaining.replace(pattern, "").trim();
      if (next !== remaining) {
        remaining = next;
        changed = true;
        break;
      }
    }
  }
  return remaining;
}

export function hasOrchestorAITrigger({ text, botUserId, triggerMentions }) {
  const source = String(text || "");
  if (!source) {
    return false;
  }
  if (botUserId && source.includes(`<@${botUserId}>`)) {
    return true;
  }

  const plainMentions = extractPlainAgentMentions(source).map((entry) => normalizeAgentName(entry));
  const normalizedTriggers = normalizeTriggerMentions(triggerMentions);
  if (normalizedTriggers.length === 0) {
    return false;
  }
  return normalizedTriggers.some((trigger) => plainMentions.includes(trigger));
}

export function stripOrchestorAITrigger(text, triggerMentions) {
  return collapseWhitespace(stripLeadingTriggerMentions(String(text || ""), triggerMentions));
}

export function resolveAssignee({ text, agentMappings, agents }) {
  const slackMentionIds = extractSlackMentionIds(text);
  const plainMentions = extractPlainAgentMentions(text);
  const mappingMatches = new Map();
  const mappingMap = normalizeMappings(agentMappings);

  for (const key of mappingLookupCandidates({ slackMentionIds, plainMentions })) {
    const matchedAgentId = mappingMap.get(String(key).toLowerCase());
    if (!matchedAgentId) {
      continue;
    }
    const agent = findAgentById(agents, matchedAgentId);
    if (agent) {
      mappingMatches.set(agent.id, {
        agent,
        matchedBy: key,
        source: "mapping",
      });
    }
  }

  if (mappingMatches.size > 1) {
    return {
      kind: "ambiguous",
      reason: "multiple_mapped_agents",
      candidates: Array.from(mappingMatches.values()).map((entry) => entry.agent),
    };
  }
  if (mappingMatches.size === 1) {
    const match = Array.from(mappingMatches.values())[0];
    return {
      kind: "match",
      agent: match.agent,
      matchedBy: match.matchedBy,
      source: match.source,
    };
  }

  const aliasMatches = new Map();
  const normalizedMentions = plainMentions.map((entry) => slugifyLookupValue(entry)).filter(Boolean);
  for (const mentionAlias of normalizedMentions) {
    const matched = (agents || []).filter((agent) => readEntityReferenceAliases(agent).includes(mentionAlias));
    for (const agent of matched) {
      aliasMatches.set(agent.id, {
        agent,
        matchedBy: mentionAlias,
        source: "agent_alias",
      });
    }
  }

  if (aliasMatches.size > 1) {
    return {
      kind: "ambiguous",
      reason: "multiple_alias_agents",
      candidates: Array.from(aliasMatches.values()).map((entry) => entry.agent),
    };
  }
  if (aliasMatches.size === 1) {
    const match = Array.from(aliasMatches.values())[0];
    return {
      kind: "match",
      agent: match.agent,
      matchedBy: match.matchedBy,
      source: match.source,
    };
  }

  const urlKeyMatches = new Map();
  for (const mentionAlias of normalizedMentions) {
    const matched = (agents || []).filter(
      (agent) => slugifyLookupValue(agent?.urlKey || "") === mentionAlias,
    );
    for (const agent of matched) {
      urlKeyMatches.set(agent.id, agent);
    }
  }

  if (urlKeyMatches.size > 1) {
    return {
      kind: "ambiguous",
      reason: "multiple_url_key_agents",
      candidates: Array.from(urlKeyMatches.values()),
    };
  }
  if (urlKeyMatches.size === 1) {
    const agent = Array.from(urlKeyMatches.values())[0];
    return {
      kind: "match",
      agent,
      matchedBy: agent.urlKey || agent.name,
      source: "agent_url_key",
    };
  }

  const exactNameMatches = new Map();
  const names = plainMentions.map((entry) => normalizeAgentName(entry));
  for (const mentionName of names) {
    if (!mentionName) {
      continue;
    }
    const matched = (agents || []).filter(
      (agent) => normalizeAgentName(agent?.name) === mentionName,
    );
    for (const agent of matched) {
      exactNameMatches.set(agent.id, agent);
    }
  }

  if (exactNameMatches.size > 1) {
    return {
      kind: "ambiguous",
      reason: "multiple_named_agents",
      candidates: Array.from(exactNameMatches.values()),
    };
  }
  if (exactNameMatches.size === 1) {
    const agent = Array.from(exactNameMatches.values())[0];
    return {
      kind: "match",
      agent,
      matchedBy: agent.name,
      source: "agent_name",
    };
  }

  return {
    kind: "none",
    reason: slackMentionIds.length > 0 || plainMentions.length > 0 ? "no_matching_agent" : "no_agent_mention",
  };
}

export function resolveProject({ text, projectMappings, projects }) {
  const selectors = extractProjectSelectors(text);
  if (selectors.length === 0) {
    return {
      kind: "none",
      reason: "no_project_selector",
      selectors,
    };
  }

  const mappingMatches = new Map();
  const mappingMap = normalizeMappings(projectMappings);

  for (const key of projectLookupCandidates(selectors)) {
    const matchedProjectId = mappingMap.get(String(key).toLowerCase());
    if (!matchedProjectId) {
      continue;
    }
    const project = findProjectById(projects, matchedProjectId);
    if (project) {
      mappingMatches.set(project.id, {
        project,
        matchedBy: key,
        source: "mapping",
      });
    }
  }

  if (mappingMatches.size > 1) {
    return {
      kind: "ambiguous",
      reason: "multiple_mapped_projects",
      selectors,
      candidates: Array.from(mappingMatches.values()).map((entry) => entry.project),
    };
  }
  if (mappingMatches.size === 1) {
    const match = Array.from(mappingMatches.values())[0];
    return {
      kind: "match",
      project: match.project,
      matchedBy: match.matchedBy,
      source: match.source,
      selectors,
    };
  }

  const aliasMatches = new Map();
  for (const selector of selectors) {
    const selectorAlias = slugifyLookupValue(selector);
    if (!selectorAlias) {
      continue;
    }
    const matched = (projects || []).filter((project) =>
      readEntityReferenceAliases(project).includes(selectorAlias),
    );
    for (const project of matched) {
      aliasMatches.set(project.id, {
        project,
        matchedBy: selectorAlias,
        source: "project_alias",
      });
    }
  }

  if (aliasMatches.size > 1) {
    return {
      kind: "ambiguous",
      reason: "multiple_alias_projects",
      selectors,
      candidates: Array.from(aliasMatches.values()).map((entry) => entry.project),
    };
  }
  if (aliasMatches.size === 1) {
    const match = Array.from(aliasMatches.values())[0];
    return {
      kind: "match",
      project: match.project,
      matchedBy: match.matchedBy,
      source: match.source,
      selectors,
    };
  }

  const urlKeyMatches = new Map();
  for (const selector of selectors) {
    const selectorAlias = slugifyLookupValue(selector);
    if (!selectorAlias) {
      continue;
    }
    const matched = (projects || []).filter(
      (project) => slugifyLookupValue(project?.urlKey || "") === selectorAlias,
    );
    for (const project of matched) {
      urlKeyMatches.set(project.id, project);
    }
  }

  if (urlKeyMatches.size > 1) {
    return {
      kind: "ambiguous",
      reason: "multiple_url_key_projects",
      selectors,
      candidates: Array.from(urlKeyMatches.values()),
    };
  }
  if (urlKeyMatches.size === 1) {
    const project = Array.from(urlKeyMatches.values())[0];
    return {
      kind: "match",
      project,
      matchedBy: project.urlKey || project.name,
      source: "project_url_key",
      selectors,
    };
  }

  const exactMatches = new Map();
  for (const selector of selectors) {
    const normalizedSelector = normalizeProjectName(selector);
    const selectorSlug = slugifyLookupValue(selector);
    if (!normalizedSelector && !selectorSlug) {
      continue;
    }
    const matched = (projects || []).filter((project) => {
      const projectName = normalizeProjectName(project?.name);
      const projectSlug = slugifyLookupValue(project?.name);
      return (
        (normalizedSelector && projectName === normalizedSelector) ||
        (selectorSlug && projectSlug === selectorSlug)
      );
    });
    for (const project of matched) {
      exactMatches.set(project.id, project);
    }
  }

  if (exactMatches.size > 1) {
    return {
      kind: "ambiguous",
      reason: "multiple_named_projects",
      selectors,
      candidates: Array.from(exactMatches.values()),
    };
  }
  if (exactMatches.size === 1) {
    const project = Array.from(exactMatches.values())[0];
    return {
      kind: "match",
      project,
      matchedBy: project.name,
      source: "project_name",
      selectors,
    };
  }

  return {
    kind: "none",
    reason: "no_matching_project",
    selectors,
  };
}

export function stripBotMention(text, botUserId, triggerMentions = []) {
  let cleaned = String(text || "");
  if (botUserId) {
    const pattern = new RegExp(`<@${String(botUserId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>`, "gi");
    cleaned = cleaned.replace(pattern, " ");
  }
  cleaned = stripLeadingTriggerMentions(cleaned, triggerMentions);
  return collapseWhitespace(cleaned);
}

export function fingerprintIssueComment(body) {
  return collapseWhitespace(body).slice(0, 120).toLowerCase();
}

export function buildIssueDescription(input) {
  const lines = [
    "Created from Slack thread.",
    "",
    "## Slack Source",
    `- Requester: ${input.senderName || "unknown"} (${input.senderId || "unknown"})`,
    `- Channel: ${input.channelName ? `#${input.channelName}` : "unknown"} (${input.channelId || "unknown"})`,
    `- Thread TS: ${input.threadTs || "unknown"}`,
    `- Message TS: ${input.messageTs || "unknown"}`,
  ];

  lines.push("");
  lines.push("## Original Message");
  lines.push("```text");
  lines.push(String(input.text || "").trim());
  lines.push("```");

  return lines.join("\n");
}

export function summarizeIssueUpdate(details) {
  const payload = details && typeof details === "object" ? details : {};
  const parts = [];

  if (payload.status) {
    const previous = payload._previous && typeof payload._previous === "object"
      ? payload._previous.status
      : null;
    if (previous && previous !== payload.status) {
      parts.push(`status ${previous} -> ${payload.status}`);
    } else {
      parts.push(`status ${payload.status}`);
    }
  }

  if (payload.priority) {
    const previous = payload._previous && typeof payload._previous === "object"
      ? payload._previous.priority
      : null;
    if (previous && previous !== payload.priority) {
      parts.push(`priority ${previous} -> ${payload.priority}`);
    } else {
      parts.push(`priority ${payload.priority}`);
    }
  }

  if (payload.assigneeAgentId !== undefined) {
    const previous = payload._previous && typeof payload._previous === "object"
      ? payload._previous.assigneeAgentId
      : null;
    if (previous && previous !== payload.assigneeAgentId) {
      parts.push("assignee changed");
    } else if (payload.assigneeAgentId) {
      parts.push("assignee updated");
    } else {
      parts.push("assignee cleared");
    }
  }

  if (payload.title) {
    parts.push(`title "${String(payload.title).trim()}"`);
  }

  return parts;
}

export function formatActivityNotification({ action, identifier, details, actorName }) {
  const issueRef = identifier ? `OrchestorAI ${identifier}` : "OrchestorAI issue";
  if (action === "issue.comment_added") {
    const snippet = String(details?.bodySnippet || "").trim();
    const prefix = actorName ? `${actorName} commented on ${issueRef}` : `Comment on ${issueRef}`;
    return snippet ? `${prefix}: ${snippet}` : `${prefix}.`;
  }
  if (action === "issue.checked_out") {
    return actorName ? `${issueRef} checked out by ${actorName}.` : `${issueRef} checked out.`;
  }
  if (action === "issue.released") {
    return actorName ? `${issueRef} released by ${actorName}.` : `${issueRef} released.`;
  }
  if (action === "issue.updated") {
    const summary = summarizeIssueUpdate(details);
    return summary.length > 0 ? `${issueRef} updated: ${summary.join(", ")}.` : `${issueRef} updated.`;
  }
  return "";
}

export function formatRunNotification({ eventType, status, identifier, agentName, error }) {
  const issueRef = identifier ? `OrchestorAI ${identifier}` : "OrchestorAI issue";
  if (eventType === "heartbeat.run.queued") {
    return agentName ? `Run queued for ${agentName} on ${issueRef}.` : `Run queued on ${issueRef}.`;
  }

  if (status === "running") {
    return agentName ? `${agentName} started work on ${issueRef}.` : `Run started on ${issueRef}.`;
  }
  if (status === "succeeded") {
    return agentName ? `${agentName} completed a run for ${issueRef}.` : `Run completed for ${issueRef}.`;
  }
  if (status === "failed") {
    return error
      ? `Run failed for ${issueRef}: ${String(error).trim()}.`
      : `Run failed for ${issueRef}.`;
  }
  if (status === "timed_out") {
    return `Run timed out for ${issueRef}.`;
  }
  if (status === "cancelled") {
    return `Run cancelled for ${issueRef}.`;
  }
  if (status === "queued") {
    return agentName ? `Run queued for ${agentName} on ${issueRef}.` : `Run queued on ${issueRef}.`;
  }
  return "";
}

export function formatChildIssueThreadRootMessage({
  childIdentifier,
  parentIdentifier,
  title,
  assigneeName,
  projectName,
}) {
  const lines = [
    parentIdentifier
      ? `Created OrchestorAI issue ${childIdentifier} from ${parentIdentifier}.`
      : `Created OrchestorAI issue ${childIdentifier}.`,
    `This thread will track ${childIdentifier}.`,
  ];

  if (title) {
    lines.push(`Title: ${String(title).trim()}`);
  }
  if (assigneeName) {
    lines.push(`Assignee: ${String(assigneeName).trim()}`);
  }
  if (projectName) {
    lines.push(`Project: ${String(projectName).trim()}`);
  }

  return lines.join("\n");
}

export function formatChildIssueParentNotice({ childIdentifier, parentIdentifier }) {
  if (!childIdentifier) {
    return "";
  }
  if (!parentIdentifier) {
    return `OrchestorAI ${childIdentifier} was created and moved to a new Slack thread.`;
  }
  return `OrchestorAI ${childIdentifier} was created from ${parentIdentifier}. I opened a new Slack thread for ${childIdentifier}.`;
}
