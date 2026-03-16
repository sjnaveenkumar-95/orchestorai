import test from "node:test";
import assert from "node:assert/strict";

import { buildManagedSlackControlEnvelope } from "../src/slack-runtime.js";

test("buildManagedSlackControlEnvelope forwards compact file metadata for managed-channel messages", () => {
  const envelope = buildManagedSlackControlEnvelope(
    {
      channel: "C0ALSDSLJ5Q",
      ts: "1773643195.026499",
      user: "U0EV31K50",
      text: "Please review this deck",
      files: [
        {
          id: "F123",
          name: "HR Process Automation.pptx",
          title: "HR Process Automation",
          mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          filetype: "pptx",
          pretty_type: "PowerPoint",
          size: 291184,
          permalink: "https://androventure.slack.com/files/U0EV31K50/F123",
          url_private: "https://files.slack.com/files-pri/T123-F123/hr-process-automation.pptx",
        },
      ],
    },
    {
      event_id: "Ev123",
      event_time: 1773643195,
      api_app_id: "A123",
    },
  );

  assert.deepEqual(envelope.event.files, [
    {
      id: "F123",
      name: "HR Process Automation.pptx",
      title: "HR Process Automation",
      mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      filetype: "pptx",
      pretty_type: "PowerPoint",
      size: 291184,
      permalink: "https://androventure.slack.com/files/U0EV31K50/F123",
    },
  ]);
});
