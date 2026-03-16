import { describe, expect, it } from "vitest";
import {
  buildSlackControlMessageText,
  isSupportedSlackControlSubtype,
} from "../services/slack-integrations.js";

describe("isSupportedSlackControlSubtype", () => {
  it("allows file share events through the managed-channel control path", () => {
    expect(isSupportedSlackControlSubtype(undefined)).toBe(true);
    expect(isSupportedSlackControlSubtype("file_share")).toBe(true);
    expect(isSupportedSlackControlSubtype("channel_join")).toBe(false);
  });
});

describe("buildSlackControlMessageText", () => {
  it("appends attachment metadata to the interpreted message text", () => {
    expect(
      buildSlackControlMessageText({
        text: "Please review this deck",
        files: [
          {
            name: "HR Process Automation.pptx",
            pretty_type: "PowerPoint",
            mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          },
        ],
      }),
    ).toBe(
      "Please review this deck\n\nAttached files:\n- HR Process Automation.pptx (PowerPoint, application/vnd.openxmlformats-officedocument.presentationml.presentation)",
    );
  });

  it("falls back to attachment metadata when the Slack message body is empty", () => {
    expect(
      buildSlackControlMessageText({
        text: "",
        files: [
          {
            name: "HR Process Automation.pptx",
            pretty_type: "PowerPoint",
          },
        ],
      }),
    ).toBe("Attached files:\n- HR Process Automation.pptx (PowerPoint)");
  });
});
