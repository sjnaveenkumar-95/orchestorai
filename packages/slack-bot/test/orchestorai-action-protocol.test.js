import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOrchestorAIActionInstructions,
  extractOrchestorAIAction,
} from "../src/orchestorai-action-protocol.js";

test("buildOrchestorAIActionInstructions documents the structured action block", () => {
  const instructions = buildOrchestorAIActionInstructions();

  assert.match(instructions, /\[\[ORCHESTORAI_ACTION\]\]/);
  assert.match(instructions, /create_issue/);
  assert.match(instructions, /add_comment/);
  assert.match(instructions, /runtime resolves the project from the Slack channel name mapping/i);
});

test("extractOrchestorAIAction returns the parsed action and stripped reply text", () => {
  const parsed = extractOrchestorAIAction([
    "[[ORCHESTORAI_ACTION]]",
    '{"type":"create_issue","title":"Create a knowledge bank"}',
    "[[/ORCHESTORAI_ACTION]]",
    "Creating that task now.",
  ].join("\n"));

  assert.deepEqual(parsed.action, {
    type: "create_issue",
    title: "Create a knowledge bank",
  });
  assert.equal(parsed.actionError, "");
  assert.equal(parsed.replyText, "Creating that task now.");
});

test("extractOrchestorAIAction preserves the reply text when the action block is invalid", () => {
  const parsed = extractOrchestorAIAction([
    "[[ORCHESTORAI_ACTION]]",
    '{"type":"create_issue",',
    "[[/ORCHESTORAI_ACTION]]",
    "I could not complete that action.",
  ].join("\n"));

  assert.equal(parsed.action, null);
  assert.match(parsed.actionError, /Expected/);
  assert.equal(parsed.replyText, "I could not complete that action.");
});
