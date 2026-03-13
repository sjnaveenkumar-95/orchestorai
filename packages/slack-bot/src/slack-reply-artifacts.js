import fs from "node:fs/promises";
import path from "node:path";

const ARTIFACT_BLOCK_START = "[[SLACK_ARTIFACTS]]";
const ARTIFACT_BLOCK_END = "[[/SLACK_ARTIFACTS]]";
const MAX_AUTO_UPLOADS = 3;

function normalizeArtifactCandidate(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const filePath = String(entry.path || "").trim();
  if (!filePath) {
    return null;
  }

  const title = String(entry.title || "").trim();
  return {
    path: filePath,
    title,
  };
}

function normalizeCandidatePathToken(raw) {
  return String(raw || "")
    .trim()
    .replace(/[)\],;:!?]+$/g, "")
    .replace(/[.]+$/g, (value) => (value === "." ? "" : value));
}

function extractAbsolutePaths(line) {
  const matches = [];
  const pattern = /(^|[\s(["'])((?:\/(?!\/)[^\s<>"'`()[\]{}]+)+)/g;
  let match = pattern.exec(line);
  while (match) {
    const candidate = normalizeCandidatePathToken(match[2]);
    if (candidate && path.isAbsolute(candidate)) {
      matches.push(candidate);
    }
    match = pattern.exec(line);
  }
  return matches;
}

function looksLikeArtifactAnnouncementLine(line, candidateCount) {
  const normalized = String(line || "").trim();
  if (!normalized || candidateCount === 0 || candidateCount > MAX_AUTO_UPLOADS) {
    return false;
  }

  if (normalized.startsWith("/")) {
    return true;
  }

  if (normalized.length > 280) {
    return false;
  }

  const lower = normalized.toLowerCase();
  return (
    /\b(saved|created|generated|captured|wrote|written|exported|rendered|uploaded|screenshot|artifact|output|report|file)\b/.test(
      lower,
    ) ||
    candidateCount === 1
  );
}

function isCommonSlackUploadDisclaimer(line) {
  const normalized = String(line || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("can't upload files to slack from this runtime") ||
    normalized.includes("can’t upload files to slack from this runtime") ||
    normalized.includes("drag that file into this thread") ||
    normalized.includes("drag the file into this thread") ||
    normalized.includes("upload files to slack from this runtime")
  );
}

function uniqueArtifacts(artifacts) {
  const deduped = [];
  const seen = new Set();
  for (const artifact of artifacts || []) {
    const normalized = normalizeArtifactCandidate(artifact);
    if (!normalized) {
      continue;
    }
    const key = normalized.path;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
}

async function validateArtifactForUpload(artifact) {
  const normalized = normalizeArtifactCandidate(artifact);
  if (!normalized) {
    return {
      ok: false,
      artifact: { path: "", title: "" },
      reason: "missing path",
    };
  }

  let stats;
  try {
    stats = await fs.stat(normalized.path);
  } catch (error) {
    return {
      ok: false,
      artifact: normalized,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  if (!stats.isFile()) {
    return {
      ok: false,
      artifact: normalized,
      reason: "path is not a file",
    };
  }

  return {
    ok: true,
    artifact: {
      ...normalized,
      filename: path.basename(normalized.path),
    },
  };
}

export function buildSlackArtifactInstructions() {
  return [
    "Slack artifact protocol:",
    `- When you create one or more user-facing local files that should be returned to Slack, emit exactly one artifact block before your normal reply using ${ARTIFACT_BLOCK_START} and ${ARTIFACT_BLOCK_END}.`,
    '- Use JSON in the block with the shape {"uploads":[{"path":"/absolute/path/to/file.png","title":"Optional title"}]}.',
    "- Use local filesystem paths and prefer absolute paths when possible.",
    "- Only include files that were actually created and are ready to upload.",
    "- Keep your normal reply concise and do not rely on raw local file paths in the visible reply when the artifact block is present.",
  ].join("\n");
}

export function extractSlackArtifacts(text) {
  const source = String(text || "");
  const match = /\[\[SLACK_ARTIFACTS\]\]\s*([\s\S]*?)\s*\[\[\/SLACK_ARTIFACTS\]\]/i.exec(source);

  if (!match) {
    return {
      artifacts: [],
      artifactError: "",
      replyText: source.trim(),
    };
  }

  const before = source.slice(0, match.index).trim();
  const after = source.slice(match.index + match[0].length).trim();
  const replyText = [before, after].filter(Boolean).join("\n\n").trim();

  try {
    const parsed = JSON.parse(match[1]);
    const uploads = Array.isArray(parsed?.uploads) ? parsed.uploads : [];
    return {
      artifacts: uniqueArtifacts(uploads).slice(0, MAX_AUTO_UPLOADS),
      artifactError: "",
      replyText,
    };
  } catch (error) {
    return {
      artifacts: [],
      artifactError: error instanceof Error ? error.message : String(error),
      replyText,
    };
  }
}

export function detectFallbackSlackArtifacts(text) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n");
  const candidates = [];
  const seen = new Set();

  for (const line of lines) {
    const paths = extractAbsolutePaths(line);
    if (!looksLikeArtifactAnnouncementLine(line, paths.length)) {
      continue;
    }

    for (const filePath of paths) {
      if (seen.has(filePath)) {
        continue;
      }
      seen.add(filePath);
      candidates.push({
        path: filePath,
        title: "",
      });
      if (candidates.length >= MAX_AUTO_UPLOADS) {
        return candidates;
      }
    }
  }

  return candidates;
}

export function collectSlackReplyArtifacts({ replyText = "", structuredArtifacts = [] }) {
  const explicitArtifacts = uniqueArtifacts(structuredArtifacts).slice(0, MAX_AUTO_UPLOADS);
  if (explicitArtifacts.length > 0) {
    return explicitArtifacts;
  }
  return detectFallbackSlackArtifacts(replyText);
}

export function finalizeSlackReplyText({ replyText = "", uploadedArtifacts = [], failedArtifacts = [] }) {
  const uploadedPaths = new Set(
    (uploadedArtifacts || []).map((artifact) => String(artifact?.path || "").trim()).filter(Boolean),
  );

  const filteredLines = String(replyText || "")
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => {
      if (uploadedPaths.size > 0 && isCommonSlackUploadDisclaimer(line)) {
        return false;
      }
      const linePaths = extractAbsolutePaths(line);
      if (linePaths.some((filePath) => uploadedPaths.has(filePath))) {
        return false;
      }
      return true;
    });

  const baseReply = filteredLines.join("\n").trim();
  const failureLines = (failedArtifacts || [])
    .filter((entry) => entry?.artifact?.path)
    .map((entry) => {
      const name = path.basename(entry.artifact.path);
      const reason = String(entry.reason || "unknown error").trim();
      return `Could not upload ${name} to Slack: ${reason}.`;
    });

  return [baseReply, ...failureLines].filter(Boolean).join("\n\n").trim();
}

export async function uploadSlackReplyArtifacts({ client, channel, threadTs, artifacts = [] }) {
  const uploads = uniqueArtifacts(artifacts).slice(0, MAX_AUTO_UPLOADS);
  if (uploads.length === 0) {
    return {
      uploadedArtifacts: [],
      failedArtifacts: [],
    };
  }

  if (typeof client?.files?.uploadV2 !== "function") {
    return {
      uploadedArtifacts: [],
      failedArtifacts: uploads.map((artifact) => ({
        artifact,
        reason: "Slack client does not support file uploads",
      })),
    };
  }

  const uploadedArtifacts = [];
  const failedArtifacts = [];

  for (const artifact of uploads) {
    const validation = await validateArtifactForUpload(artifact);
    if (!validation.ok) {
      failedArtifacts.push({
        artifact: validation.artifact,
        reason: validation.reason,
      });
      continue;
    }

    const upload = validation.artifact;
    try {
      await client.files.uploadV2({
        channel_id: channel,
        ...(threadTs ? { thread_ts: threadTs } : {}),
        file: upload.path,
        filename: upload.filename,
        title: upload.title || upload.filename,
      });
      uploadedArtifacts.push({
        path: upload.path,
        title: upload.title || upload.filename,
      });
    } catch (error) {
      failedArtifacts.push({
        artifact: upload,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    uploadedArtifacts,
    failedArtifacts,
  };
}
