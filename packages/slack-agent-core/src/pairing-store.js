import fs from "node:fs";
import path from "node:path";

function nowIso() {
  return new Date().toISOString();
}

function randomCode(length = 6) {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += String(Math.floor(Math.random() * 10));
  }
  return out;
}

export class PairingStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, "pairing-store.json");
    this.state = {
      approved: {},
      pending: {},
    };
  }

  ensureLoaded() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      this.save();
      return;
    }
    const raw = fs.readFileSync(this.filePath, "utf8");
    if (!raw.trim()) {
      this.save();
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      this.state = {
        approved: parsed.approved && typeof parsed.approved === "object" ? parsed.approved : {},
        pending: parsed.pending && typeof parsed.pending === "object" ? parsed.pending : {},
      };
    } catch {
      this.save();
    }
  }

  save() {
    const payload = JSON.stringify(this.state, null, 2) + "\n";
    fs.writeFileSync(this.filePath, payload, "utf8");
  }

  isApproved(userId) {
    return Boolean(this.state.approved[userId]);
  }

  approveByCode(code) {
    const normalized = String(code || "").trim();
    if (!normalized) {
      return null;
    }

    for (const [userId, pending] of Object.entries(this.state.pending)) {
      if (pending?.code !== normalized) {
        continue;
      }
      this.state.approved[userId] = {
        approvedAt: nowIso(),
        meta: pending.meta || {},
      };
      delete this.state.pending[userId];
      this.save();
      return { userId, approvedAt: this.state.approved[userId].approvedAt };
    }
    return null;
  }

  upsertChallenge(userId, meta = {}) {
    const existing = this.state.pending[userId];
    if (existing && existing.code) {
      return existing;
    }
    const entry = {
      code: randomCode(6),
      createdAt: nowIso(),
      meta,
    };
    this.state.pending[userId] = entry;
    this.save();
    return entry;
  }

  listPending() {
    return Object.entries(this.state.pending).map(([userId, entry]) => ({ userId, ...entry }));
  }

  listApproved() {
    return Object.entries(this.state.approved).map(([userId, entry]) => ({ userId, ...entry }));
  }
}
