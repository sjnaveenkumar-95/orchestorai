import test from "node:test";
import assert from "node:assert/strict";

import { channelBotOwnsChannelType } from "../src/slack-runtime.js";

test("channel runtime owns channels and mpims but not direct messages", () => {
  assert.equal(channelBotOwnsChannelType("channel"), true);
  assert.equal(channelBotOwnsChannelType("group"), true);
  assert.equal(channelBotOwnsChannelType("mpim"), true);
  assert.equal(channelBotOwnsChannelType("im"), false);
});
