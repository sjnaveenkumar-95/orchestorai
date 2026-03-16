import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CompanyChatRoom } from "@orchestorai/shared";
import { SocialRoomSettingsCard } from "./SocialRoomSettingsSection";
import { TooltipProvider } from "./ui/tooltip";

function buildRoom(overrides: Partial<CompanyChatRoom> = {}): CompanyChatRoom {
  return {
    id: "room-1",
    companyId: "company-1",
    displayName: "Andro chat room",
    slackChannelId: "C123",
    slackChannelName: "andro-chat-room",
    status: "active",
    enabled: true,
    idleThresholdHours: 3,
    maxAutonomousThreads: 3,
    autonomousStartEnabled: true,
    allowedTopics: [
      {
        slug: "coffee-break",
        label: "Coffee Break",
        description: "Casual off-work chatter.",
        autonomousAllowed: true,
        internetAllowed: true,
      },
    ],
    chatBudgetMonthlyCents: 2500,
    chatSpentMonthlyCents: 400,
    promptPackDir: "/tmp/social-room",
    promptSystemPath: "/tmp/social-room/SYSTEM.md",
    promptAgentsPath: "/tmp/social-room/AGENTS.md",
    promptSoulPath: "/tmp/social-room/SOUL.md",
    lastRoomActivityAt: new Date("2026-03-13T08:00:00.000Z"),
    lastError: null,
    archivedAt: null,
    createdAt: new Date("2026-03-12T08:00:00.000Z"),
    updatedAt: new Date("2026-03-13T08:05:00.000Z"),
    ...overrides,
  };
}

function renderCard(element: ReactElement) {
  return renderToStaticMarkup(<TooltipProvider>{element}</TooltipProvider>);
}

describe("SocialRoomSettingsCard", () => {
  it("renders provisioning state without exposing prompt-pack files", () => {
    const html = renderCard(
      <SocialRoomSettingsCard
        room={null}
        companyName="Androventure"
        form={null}
        dirty={false}
        isLoading={false}
        loadError={null}
        saveError={null}
        provisionError={null}
        isProvisioning={false}
        isSaving={false}
        onProvision={() => undefined}
        onFormChange={() => undefined}
        onTopicAdd={() => undefined}
        onTopicRemove={() => undefined}
        onSave={() => undefined}
      />,
    );

    expect(html).toContain("Social Room");
    expect(html).toContain("Provision social room");
    expect(html).not.toContain("SYSTEM.md");
    expect(html).not.toContain("AGENTS.md");
    expect(html).not.toContain("SOUL.md");
  });

  it("renders editable room controls and allowed topics", () => {
    const html = renderCard(
      <SocialRoomSettingsCard
        room={buildRoom()}
        companyName="Androventure"
        form={{
          displayName: "Andro chat room",
          slackChannelName: "andro-chat-room",
          enabled: true,
          idleThresholdHours: 3,
          maxAutonomousThreads: 3,
          autonomousStartEnabled: true,
          chatBudgetMonthlyCents: 2500,
          allowedTopics: [
            {
              slug: "coffee-break",
              label: "Coffee Break",
              description: "Casual off-work chatter.",
              autonomousAllowed: true,
            },
          ],
        }}
        dirty={false}
        isLoading={false}
        loadError={null}
        saveError={null}
        provisionError={null}
        isProvisioning={false}
        isSaving={false}
        onProvision={() => undefined}
        onFormChange={() => undefined}
        onTopicAdd={() => undefined}
        onTopicRemove={() => undefined}
        onSave={() => undefined}
      />,
    );

    expect(html).toContain("Display name");
    expect(html).toContain("Slack channel name");
    expect(html).toContain("Allowed topics");
    expect(html).toContain("Coffee Break");
    expect(html).not.toContain("SYSTEM.md");
    expect(html).not.toContain("AGENTS.md");
    expect(html).not.toContain("SOUL.md");
  });
});
