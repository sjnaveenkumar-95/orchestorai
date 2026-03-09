import fs from "node:fs";
import path from "node:path";

const MAX_FINGERPRINT_AGE_MS = 10 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function toMillis(value) {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function makeThreadKey(channelId, threadTs) {
  return `${String(channelId || "").trim()}:${String(threadTs || "").trim()}`;
}

function makeFingerprintKey(issueId, fingerprint) {
  return `${String(issueId || "").trim()}:${String(fingerprint || "").trim()}`;
}

export class OrchestorAIThreadStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, "orchestorai-thread-store.json");
    this.state = {
      mappings: {},
      issueIndex: {},
      fingerprints: {},
      preferences: {
        preferredChannels: {},
      },
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
        mappings: parsed.mappings && typeof parsed.mappings === "object" ? parsed.mappings : {},
        issueIndex: parsed.issueIndex && typeof parsed.issueIndex === "object" ? parsed.issueIndex : {},
        fingerprints: parsed.fingerprints && typeof parsed.fingerprints === "object" ? parsed.fingerprints : {},
        preferences:
          parsed.preferences && typeof parsed.preferences === "object"
            ? {
                preferredChannels:
                  parsed.preferences.preferredChannels &&
                  typeof parsed.preferences.preferredChannels === "object"
                    ? parsed.preferences.preferredChannels
                    : {},
              }
            : { preferredChannels: {} },
      };
      this.pruneFingerprints();
    } catch {
      this.save();
    }
  }

  save() {
    this.pruneFingerprints();
    const payload = JSON.stringify(this.state, null, 2) + "\n";
    fs.writeFileSync(this.filePath, payload, "utf8");
  }

  pruneFingerprints() {
    const threshold = Date.now() - MAX_FINGERPRINT_AGE_MS;
    for (const [key, entry] of Object.entries(this.state.fingerprints)) {
      const createdAt = toMillis(entry?.createdAt);
      if (!createdAt || createdAt < threshold) {
        delete this.state.fingerprints[key];
      }
    }
  }

  putMapping(mapping) {
    const threadKey = makeThreadKey(mapping.channelId, mapping.threadTs);
    const next = {
      ...mapping,
      createdAt: mapping.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
    this.state.mappings[threadKey] = next;
    if (mapping.issueId) {
      this.state.issueIndex[String(mapping.issueId)] = threadKey;
    }
    this.save();
    return next;
  }

  getMapping(channelId, threadTs) {
    const entry = this.state.mappings[makeThreadKey(channelId, threadTs)];
    return entry ? { ...entry } : null;
  }

  getMappingByIssueId(issueId) {
    const threadKey = this.state.issueIndex[String(issueId || "").trim()];
    if (!threadKey) {
      return null;
    }
    const entry = this.state.mappings[threadKey];
    return entry ? { ...entry } : null;
  }

  rememberSlackFingerprint(issueId, fingerprint) {
    const key = makeFingerprintKey(issueId, fingerprint);
    if (!issueId || !fingerprint) {
      return;
    }
    this.state.fingerprints[key] = {
      issueId: String(issueId),
      fingerprint: String(fingerprint),
      createdAt: nowIso(),
    };
    this.save();
  }

  hasRecentSlackFingerprint(issueId, fingerprint) {
    this.pruneFingerprints();
    const entry = this.state.fingerprints[makeFingerprintKey(issueId, fingerprint)];
    if (!entry) {
      return false;
    }
    return Date.now() - toMillis(entry.createdAt) <= MAX_FINGERPRINT_AGE_MS;
  }

  setPreferredChannel(companyId, channelId) {
    const normalizedCompanyId = String(companyId || "").trim();
    const normalizedChannelId = String(channelId || "").trim();
    if (!normalizedCompanyId || !normalizedChannelId) {
      return;
    }
    this.state.preferences.preferredChannels[normalizedCompanyId] = {
      channelId: normalizedChannelId,
      updatedAt: nowIso(),
    };
    this.save();
  }

  getPreferredChannel(companyId) {
    const normalizedCompanyId = String(companyId || "").trim();
    if (!normalizedCompanyId) {
      return "";
    }

    const stored = this.state.preferences.preferredChannels[normalizedCompanyId];
    const storedChannelId = String(stored?.channelId || "").trim();
    if (storedChannelId) {
      return storedChannelId;
    }

    let latestChannelId = "";
    let latestUpdatedAt = 0;
    for (const mapping of Object.values(this.state.mappings)) {
      if (String(mapping?.companyId || "").trim() !== normalizedCompanyId) {
        continue;
      }
      const candidateChannelId = String(mapping?.channelId || "").trim();
      if (!candidateChannelId) {
        continue;
      }
      const updatedAt = Math.max(toMillis(mapping?.updatedAt), toMillis(mapping?.createdAt));
      if (updatedAt >= latestUpdatedAt) {
        latestUpdatedAt = updatedAt;
        latestChannelId = candidateChannelId;
      }
    }
    return latestChannelId;
  }
}
