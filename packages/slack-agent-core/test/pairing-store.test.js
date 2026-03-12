import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PairingStore } from "../src/index.js";

test("PairingStore persists pending approvals and promotes them by code", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "slack-agent-core-pairing-"));
  const store = new PairingStore(dataDir);
  store.ensureLoaded();

  const challenge = store.upsertChallenge("U123", { name: "Naveen" });
  assert.match(challenge.code, /^\d{6}$/);
  assert.equal(store.isApproved("U123"), false);

  const approved = store.approveByCode(challenge.code);
  assert.equal(approved?.userId, "U123");
  assert.equal(store.isApproved("U123"), true);
  assert.equal(store.listPending().length, 0);
  assert.equal(store.listApproved().length, 1);
});
