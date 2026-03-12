const ACTION_BLOCK_START = "[[ORCHESTORAI_ACTION]]";
const ACTION_BLOCK_END = "[[/ORCHESTORAI_ACTION]]";

export function buildOrchestorAIActionInstructions() {
  return [
    "OrchestorAI action protocol:",
    `- When the user is asking you to mutate OrchestorAI, emit exactly one action block before your normal reply using ${ACTION_BLOCK_START} and ${ACTION_BLOCK_END}.`,
    "- Supported actions right now:",
    '- {"type":"create_issue","title":"...","assignee":"...","project":"...","description":"...","priority":"medium"}',
    '- {"type":"add_comment","body":"...","issueRef":"MSS-8"}',
    "- If the current Slack thread is already mapped to an OrchestorAI issue, omit issueRef for add_comment unless the user explicitly points to a different ticket.",
    "- For create_issue in Slack channels or private groups, omit project entirely. The runtime resolves the project from the Slack channel name mapping.",
    "- Only include project when there is no channel context and the user explicitly names a project.",
    "- Do not just acknowledge an OrchestorAI action request. Emit an action block whenever the user is asking you to create a ticket, add a ticket comment, or otherwise change OrchestorAI state.",
    "- Keep the natural-language reply concise and factual. Do not invent OrchestorAI identifiers; the runtime will append the execution result.",
  ].join("\n");
}

export function extractOrchestorAIAction(text) {
  const source = String(text || "");
  const match = /\[\[ORCHESTORAI_ACTION\]\]\s*([\s\S]*?)\s*\[\[\/ORCHESTORAI_ACTION\]\]/i.exec(
    source,
  );

  if (!match) {
    return {
      action: null,
      actionError: "",
      replyText: source.trim(),
    };
  }

  const before = source.slice(0, match.index).trim();
  const after = source.slice(match.index + match[0].length).trim();
  const replyText = [before, after].filter(Boolean).join("\n\n").trim();

  try {
    const action = JSON.parse(match[1]);
    return {
      action,
      actionError: "",
      replyText,
    };
  } catch (error) {
    return {
      action: null,
      actionError: error instanceof Error ? error.message : String(error),
      replyText,
    };
  }
}
