import test from "node:test";
import assert from "node:assert/strict";

import { dmOwnsChannelType } from "../src/runtime.js";

test("dm runtime owns only direct messages", () => {
  assert.equal(dmOwnsChannelType("im"), true);
  assert.equal(dmOwnsChannelType("channel"), false);
  assert.equal(dmOwnsChannelType("group"), false);
  assert.equal(dmOwnsChannelType("mpim"), false);
});
