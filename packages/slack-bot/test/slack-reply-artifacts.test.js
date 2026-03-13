import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";

import {
  buildSlackArtifactInstructions,
  collectSlackReplyArtifacts,
  extractSlackArtifacts,
  finalizeSlackReplyText,
  uploadSlackReplyArtifacts,
} from "../src/slack-reply-artifacts.js";

test("buildSlackArtifactInstructions documents the structured artifact block", () => {
  const instructions = buildSlackArtifactInstructions();

  assert.match(instructions, /\[\[SLACK_ARTIFACTS\]\]/);
  assert.match(instructions, /local filesystem paths/i);
  assert.match(instructions, /uploads/i);
});

test("extractSlackArtifacts parses uploads and strips the block from the reply", () => {
  const parsed = extractSlackArtifacts([
    "[[SLACK_ARTIFACTS]]",
    '{"uploads":[{"path":"/tmp/report.pdf","title":"Quarterly report"}]}',
    "[[/SLACK_ARTIFACTS]]",
    "Uploaded the report.",
  ].join("\n"));

  assert.deepEqual(parsed.artifacts, [
    {
      path: "/tmp/report.pdf",
      title: "Quarterly report",
    },
  ]);
  assert.equal(parsed.artifactError, "");
  assert.equal(parsed.replyText, "Uploaded the report.");
});

test("collectSlackReplyArtifacts falls back to obvious local artifact lines", () => {
  const artifacts = collectSlackReplyArtifacts({
    replyText: [
      "Screenshot captured successfully: /tmp/codex-screenshot-20260313-014825.png (985 KB).",
      "",
      "I can’t upload files to Slack from this runtime, but you can drag that file into this thread.",
    ].join("\n"),
    structuredArtifacts: [],
  });

  assert.deepEqual(artifacts, [
    {
      path: "/tmp/codex-screenshot-20260313-014825.png",
      title: "",
    },
  ]);
});

test("finalizeSlackReplyText removes uploaded path lines and stale upload disclaimers", () => {
  const finalReply = finalizeSlackReplyText({
    replyText: [
      "Screenshot captured successfully: /tmp/codex-screenshot-20260313-014825.png (985 KB).",
      "",
      "I can’t upload files to Slack from this runtime, but you can drag that file into this thread.",
    ].join("\n"),
    uploadedArtifacts: [
      {
        path: "/tmp/codex-screenshot-20260313-014825.png",
        title: "codex-screenshot-20260313-014825.png",
      },
    ],
    failedArtifacts: [],
  });

  assert.equal(finalReply, "");
});

test("uploadSlackReplyArtifacts uploads arbitrary local files into the same Slack thread", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "slack-artifact-test-"));
  const filePath = path.join(tempDir, "codex-main-screen-20260313-085354.mp4");
  const uploads = [];

  try {
    await writeFile(filePath, "fake image bytes");

    const result = await uploadSlackReplyArtifacts({
      client: {
        files: {
          async uploadV2(args) {
            uploads.push(args);
            return { ok: true };
          },
        },
      },
      channel: "C123",
      threadTs: "1710000000.000100",
      artifacts: [
        {
          path: filePath,
          title: "",
        },
      ],
    });

    assert.deepEqual(result.uploadedArtifacts, [
      {
        path: filePath,
        title: "codex-main-screen-20260313-085354.mp4",
      },
    ]);
    assert.deepEqual(result.failedArtifacts, []);
    assert.deepEqual(uploads, [
      {
        channel_id: "C123",
        thread_ts: "1710000000.000100",
        file: filePath,
        filename: "codex-main-screen-20260313-085354.mp4",
        title: "codex-main-screen-20260313-085354.mp4",
      },
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("uploadSlackReplyArtifacts uploads hidden and previously oversized files without local gating", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "slack-artifact-large-test-"));
  const hiddenPath = path.join(tempDir, ".env");
  const largePath = path.join(tempDir, "large-recording.mov");
  const uploads = [];

  try {
    await writeFile(hiddenPath, "SECRET_TOKEN=value\n");
    await writeFile(largePath, "");
    await truncate(largePath, 26 * 1024 * 1024);

    const result = await uploadSlackReplyArtifacts({
      client: {
        files: {
          async uploadV2(args) {
            uploads.push(args);
            return { ok: true };
          },
        },
      },
      channel: "C123",
      threadTs: "1710000000.000100",
      artifacts: [
        {
          path: hiddenPath,
          title: "",
        },
        {
          path: largePath,
          title: "",
        },
      ],
    });

    assert.deepEqual(result.uploadedArtifacts, [
      {
        path: hiddenPath,
        title: ".env",
      },
      {
        path: largePath,
        title: "large-recording.mov",
      },
    ]);
    assert.deepEqual(result.failedArtifacts, []);
    assert.deepEqual(
      uploads.map((entry) => ({
        channel_id: entry.channel_id,
        thread_ts: entry.thread_ts,
        file: entry.file,
        filename: entry.filename,
        title: entry.title,
      })),
      [
        {
          channel_id: "C123",
          thread_ts: "1710000000.000100",
          file: hiddenPath,
          filename: ".env",
          title: ".env",
        },
        {
          channel_id: "C123",
          thread_ts: "1710000000.000100",
          file: largePath,
          filename: "large-recording.mov",
          title: "large-recording.mov",
        },
      ],
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
