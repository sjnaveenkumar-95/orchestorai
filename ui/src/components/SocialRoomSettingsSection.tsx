import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CompanyChatRoom, UpdateCompanyChatRoom } from "@orchestorai/shared";
import { Plus, Trash2 } from "lucide-react";
import { socialRoomApi } from "../api/socialRoom";
import { queryKeys } from "../lib/queryKeys";
import { formatCents, formatDateTime } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Field, ToggleField } from "./agent-config-primitives";

export interface SocialRoomTopicDraft {
  slug: string;
  label: string;
  description: string;
  autonomousAllowed: boolean;
}

export interface SocialRoomFormState {
  displayName: string;
  slackChannelName: string;
  enabled: boolean;
  idleThresholdHours: number;
  maxAutonomousThreads: number;
  autonomousStartEnabled: boolean;
  chatBudgetMonthlyCents: number;
  allowedTopics: SocialRoomTopicDraft[];
}

interface SocialRoomSettingsCardProps {
  room: CompanyChatRoom | null;
  companyName: string;
  form: SocialRoomFormState | null;
  dirty: boolean;
  isLoading: boolean;
  loadError: string | null;
  saveError: string | null;
  provisionError: string | null;
  isProvisioning: boolean;
  isSaving: boolean;
  onProvision: () => void;
  onFormChange: (patch: Partial<SocialRoomFormState>) => void;
  onTopicAdd: () => void;
  onTopicRemove: (index: number) => void;
  onTopicChange?: (index: number, patch: Partial<SocialRoomTopicDraft>) => void;
  onSave: () => void;
}

function normalizeTopicSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function createEmptyTopic(): SocialRoomTopicDraft {
  return {
    slug: "",
    label: "",
    description: "",
    autonomousAllowed: true,
  };
}

export function createSocialRoomFormState(room: CompanyChatRoom): SocialRoomFormState {
  return {
    displayName: room.displayName,
    slackChannelName: room.slackChannelName ?? "",
    enabled: room.enabled,
    idleThresholdHours: room.idleThresholdHours,
    maxAutonomousThreads: room.maxAutonomousThreads,
    autonomousStartEnabled: room.autonomousStartEnabled,
    chatBudgetMonthlyCents: room.chatBudgetMonthlyCents,
    allowedTopics: room.allowedTopics.map((topic) => ({
      slug: topic.slug,
      label: topic.label,
      description: topic.description ?? "",
      autonomousAllowed: topic.autonomousAllowed,
    })),
  };
}

function buildUpdatePayload(form: SocialRoomFormState): UpdateCompanyChatRoom {
  return {
    displayName: form.displayName.trim() || "Social Room",
    slackChannelName: form.slackChannelName.trim() || null,
    enabled: form.enabled,
    idleThresholdHours: Math.min(168, Math.max(1, Math.round(form.idleThresholdHours || 0))),
    maxAutonomousThreads: Math.min(20, Math.max(1, Math.round(form.maxAutonomousThreads || 0))),
    autonomousStartEnabled: form.autonomousStartEnabled,
    chatBudgetMonthlyCents: Math.max(0, Math.round(form.chatBudgetMonthlyCents || 0)),
    allowedTopics: form.allowedTopics
      .map((topic) => {
        const label = topic.label.trim();
        const slug = normalizeTopicSlug(topic.slug || label);
        if (!label || !slug) return null;
        return {
          slug,
          label,
          description: topic.description.trim() || null,
          autonomousAllowed: topic.autonomousAllowed,
          internetAllowed: true,
        };
      })
      .filter((topic): topic is NonNullable<typeof topic> => Boolean(topic)),
  };
}

function hasSocialRoomChanges(room: CompanyChatRoom, form: SocialRoomFormState) {
  return JSON.stringify(buildUpdatePayload(form)) !== JSON.stringify(buildUpdatePayload(createSocialRoomFormState(room)));
}

export function SocialRoomSettingsCard({
  room,
  companyName,
  form,
  dirty,
  isLoading,
  loadError,
  saveError,
  provisionError,
  isProvisioning,
  isSaving,
  onProvision,
  onFormChange,
  onTopicAdd,
  onTopicRemove,
  onTopicChange = () => undefined,
  onSave,
}: SocialRoomSettingsCardProps) {
  return (
    <div className="space-y-4">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Social Room
      </div>
      <div className="space-y-4 rounded-md border border-border px-4 py-4">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">Company social chat room</div>
            {room ? (
              <span className="inline-flex rounded-full border border-border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {room.status}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Slack-first general discussion space for casual company chatter, autonomous topic starts,
            and human participation.
          </p>
        </div>

        {isLoading ? <p className="text-sm text-muted-foreground">Loading social room settings...</p> : null}
        {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}

        {!isLoading && !loadError && !room ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              No social room has been provisioned for {companyName} yet.
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={onProvision} disabled={isProvisioning}>
                {isProvisioning ? "Provisioning..." : "Provision social room"}
              </Button>
              {provisionError ? <span className="text-xs text-destructive">{provisionError}</span> : null}
            </div>
          </div>
        ) : null}

        {room && form ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label="Display name"
                hint="Human-facing room label. This is the name users recognize for the company social room."
              >
                <Input
                  type="text"
                  value={form.displayName}
                  onChange={(event) => onFormChange({ displayName: event.target.value })}
                />
              </Field>
              <Field
                label="Slack channel name"
                hint="Optional Slack slug override. Leave blank to keep the current normalized channel slug."
              >
                <Input
                  type="text"
                  value={form.slackChannelName}
                  placeholder="andro-chat-room"
                  onChange={(event) => onFormChange({ slackChannelName: event.target.value })}
                />
              </Field>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-border px-3 py-2">
                <ToggleField
                  label="Enabled"
                  hint="Turns the company social room on or off without deleting its history."
                  checked={form.enabled}
                  onChange={(enabled) => onFormChange({ enabled })}
                />
              </div>
              <div className="rounded-md border border-border px-3 py-2">
                <ToggleField
                  label="Autonomous starts"
                  hint="Allows agents to start a new thread after room inactivity when the last discussion is done."
                  checked={form.autonomousStartEnabled}
                  onChange={(autonomousStartEnabled) => onFormChange({ autonomousStartEnabled })}
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <Field
                label="Idle threshold (hours)"
                hint="How long the room must stay inactive before the scheduler considers starting a new autonomous discussion."
              >
                <Input
                  type="number"
                  min={1}
                  max={168}
                  value={form.idleThresholdHours}
                  onChange={(event) =>
                    onFormChange({ idleThresholdHours: Number.parseInt(event.target.value || "0", 10) || 0 })
                  }
                />
              </Field>
              <Field
                label="Max autonomous threads"
                hint="Nominal cap for concurrent agent-started discussions. Human-started threads still bypass this cap."
              >
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={form.maxAutonomousThreads}
                  onChange={(event) =>
                    onFormChange({ maxAutonomousThreads: Number.parseInt(event.target.value || "0", 10) || 0 })
                  }
                />
              </Field>
              <Field
                label="Monthly chat budget (cents)"
                hint="Separate soft cap for social-room activity. Normal company spend limits still apply."
              >
                <Input
                  type="number"
                  min={0}
                  value={form.chatBudgetMonthlyCents}
                  onChange={(event) =>
                    onFormChange({ chatBudgetMonthlyCents: Number.parseInt(event.target.value || "0", 10) || 0 })
                  }
                />
              </Field>
            </div>

            <div className="grid gap-2 rounded-md border border-border/70 bg-muted/20 px-3 py-3 text-xs text-muted-foreground md:grid-cols-3">
              <div>
                <span className="font-medium text-foreground">Channel:</span>{" "}
                <span className="font-mono">#{room.slackChannelName ?? "pending"}</span>
              </div>
              <div>
                <span className="font-medium text-foreground">Spent this month:</span>{" "}
                {formatCents(room.chatSpentMonthlyCents)}
              </div>
              <div>
                <span className="font-medium text-foreground">Last activity:</span>{" "}
                {room.lastRoomActivityAt ? formatDateTime(room.lastRoomActivityAt) : "No activity yet"}
              </div>
            </div>

            {room.lastError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {room.lastError}
              </div>
            ) : null}

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Allowed topics</div>
                  <p className="text-xs text-muted-foreground">
                    These only govern autonomous agent-started discussions. Human-started threads can be about anything.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={onTopicAdd}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add topic
                </Button>
              </div>

              <div className="space-y-3">
                {form.allowedTopics.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                    No autonomous topics configured yet.
                  </div>
                ) : null}

                {form.allowedTopics.map((topic, index) => (
                  <div key={`${topic.slug}-${index}`} className="space-y-3 rounded-md border border-border px-3 py-3">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                      <Field label="Label" hint="Human-friendly topic name shown to operators.">
                        <Input
                          type="text"
                          value={topic.label}
                          placeholder="Coffee Break"
                          onChange={(event) => onTopicChange(index, { label: event.target.value })}
                        />
                      </Field>
                      <Field
                        label="Slug"
                        hint="Optional stable key for policy matching. Leave blank to derive it from the label when saving."
                      >
                        <Input
                          type="text"
                          value={topic.slug}
                          placeholder="coffee-break"
                          onChange={(event) => onTopicChange(index, { slug: event.target.value })}
                        />
                      </Field>
                      <div className="flex items-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground"
                          onClick={() => onTopicRemove(index)}
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                          Remove
                        </Button>
                      </div>
                    </div>

                    <Field
                      label="Description"
                      hint="Short guidance for what kinds of autonomous conversations fit this topic."
                    >
                      <Textarea
                        value={topic.description}
                        placeholder="Casual off-work chatter, light gossip, and random observations."
                        onChange={(event) => onTopicChange(index, { description: event.target.value })}
                      />
                    </Field>

                    <div className="rounded-md border border-border px-3 py-2">
                      <ToggleField
                        label="Allow autonomous starts"
                        hint="When enabled, the scheduler may choose this topic for agent-started discussions."
                        checked={topic.autonomousAllowed}
                        onChange={(autonomousAllowed) => onTopicChange(index, { autonomousAllowed })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={onSave} disabled={isSaving || !dirty}>
                {isSaving ? "Saving..." : "Save social room settings"}
              </Button>
              {!dirty && !isSaving ? (
                <span className="text-xs text-muted-foreground">No unsaved social-room changes.</span>
              ) : null}
              {saveError ? <span className="text-xs text-destructive">{saveError}</span> : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function SocialRoomSettingsSection({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const queryClient = useQueryClient();
  const roomQuery = useQuery({
    queryKey: queryKeys.socialRoom.room(companyId),
    queryFn: () => socialRoomApi.getRoom(companyId),
    enabled: companyId.length > 0,
  });

  const [form, setForm] = useState<SocialRoomFormState | null>(null);

  useEffect(() => {
    setForm(roomQuery.data ? createSocialRoomFormState(roomQuery.data) : null);
  }, [roomQuery.data]);

  const provisionMutation = useMutation({
    mutationFn: () => socialRoomApi.provisionRoom(companyId),
    onSuccess: (room) => {
      queryClient.setQueryData(queryKeys.socialRoom.room(companyId), room);
    },
  });

  const saveMutation = useMutation({
    mutationFn: (patch: UpdateCompanyChatRoom) => socialRoomApi.updateRoom(companyId, patch),
    onSuccess: (room) => {
      queryClient.setQueryData(queryKeys.socialRoom.room(companyId), room);
      setForm(createSocialRoomFormState(room));
    },
  });

  const dirty = useMemo(() => {
    if (!roomQuery.data || !form) return false;
    return hasSocialRoomChanges(roomQuery.data, form);
  }, [form, roomQuery.data]);

  function updateForm(patch: Partial<SocialRoomFormState>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
    saveMutation.reset();
  }

  function updateTopic(index: number, patch: Partial<SocialRoomTopicDraft>) {
    setForm((current) => {
      if (!current) return current;
      const allowedTopics = current.allowedTopics.map((topic, topicIndex) =>
        topicIndex === index ? { ...topic, ...patch } : topic,
      );
      return { ...current, allowedTopics };
    });
    saveMutation.reset();
  }

  function addTopic() {
    setForm((current) => {
      if (!current) return current;
      return {
        ...current,
        allowedTopics: [...current.allowedTopics, createEmptyTopic()],
      };
    });
    saveMutation.reset();
  }

  function removeTopic(index: number) {
    setForm((current) => {
      if (!current) return current;
      return {
        ...current,
        allowedTopics: current.allowedTopics.filter((_, topicIndex) => topicIndex !== index),
      };
    });
    saveMutation.reset();
  }

  function saveRoom() {
    if (!form) return;
    saveMutation.mutate(buildUpdatePayload(form));
  }

  return (
    <SocialRoomSettingsCard
      room={roomQuery.data ?? null}
      companyName={companyName}
      form={form}
      dirty={dirty}
      isLoading={roomQuery.isLoading}
      loadError={
        roomQuery.error instanceof Error ? roomQuery.error.message : roomQuery.error ? "Failed to load social room." : null
      }
      saveError={
        saveMutation.error instanceof Error ? saveMutation.error.message : saveMutation.error ? "Failed to save social room." : null
      }
      provisionError={
        provisionMutation.error instanceof Error
          ? provisionMutation.error.message
          : provisionMutation.error
            ? "Failed to provision social room."
            : null
      }
      isProvisioning={provisionMutation.isPending}
      isSaving={saveMutation.isPending}
      onProvision={() => provisionMutation.mutate()}
      onFormChange={updateForm}
      onTopicAdd={addTopic}
      onTopicRemove={removeTopic}
      onTopicChange={updateTopic}
      onSave={saveRoom}
    />
  );
}
