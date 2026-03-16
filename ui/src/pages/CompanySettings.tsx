import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  InstanceRuntimeSecretStatus,
  InstanceRuntimeValueStatus,
  UpdateInstanceRuntimeSettings
} from "@orchestorai/shared";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { companiesApi } from "../api/companies";
import { accessApi } from "../api/access";
import { instanceApi } from "../api/instance";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Settings, Check } from "lucide-react";
import { CompanyPatternIcon } from "../components/CompanyPatternIcon";
import { SocialRoomSettingsSection } from "../components/SocialRoomSettingsSection";
import {
  Field,
  ToggleField,
  HintIcon
} from "../components/agent-config-primitives";

type AgentSnippetInput = {
  onboardingTextUrl: string;
  connectionCandidates?: string[] | null;
  testResolutionUrl?: string | null;
};

export function CompanySettings() {
  const {
    companies,
    selectedCompany,
    selectedCompanyId,
    setSelectedCompanyId
  } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  // General settings local state
  const [companyName, setCompanyName] = useState("");
  const [description, setDescription] = useState("");
  const [brandColor, setBrandColor] = useState("");

  // Sync local state from selected company
  useEffect(() => {
    if (!selectedCompany) return;
    setCompanyName(selectedCompany.name);
    setDescription(selectedCompany.description ?? "");
    setBrandColor(selectedCompany.brandColor ?? "");
  }, [selectedCompany]);

  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSnippet, setInviteSnippet] = useState<string | null>(null);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [snippetCopyDelightId, setSnippetCopyDelightId] = useState(0);
  const [slackBotToken, setSlackBotToken] = useState("");
  const [slackAppToken, setSlackAppToken] = useState("");
  const [slackManifestToken, setSlackManifestToken] = useState("");
  const [slackSigningSecret, setSlackSigningSecret] = useState("");
  const [authPublicBaseUrl, setAuthPublicBaseUrl] = useState("");
  const [slackDefaultChannelMemberIds, setSlackDefaultChannelMemberIds] = useState("");
  const [slackBoardApproverUserIds, setSlackBoardApproverUserIds] = useState("");
  const [betterAuthSecret, setBetterAuthSecret] = useState("");

  const generalDirty =
    !!selectedCompany &&
    (companyName !== selectedCompany.name ||
      description !== (selectedCompany.description ?? "") ||
      brandColor !== (selectedCompany.brandColor ?? ""));

  const generalMutation = useMutation({
    mutationFn: (data: {
      name: string;
      description: string | null;
      brandColor: string | null;
    }) => companiesApi.update(selectedCompanyId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  const settingsMutation = useMutation({
    mutationFn: (requireApproval: boolean) =>
      companiesApi.update(selectedCompanyId!, {
        requireBoardApprovalForNewAgents: requireApproval
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      accessApi.createCompanyInvite(selectedCompanyId!, {
        allowedJoinTypes: "agent"
      }),
    onSuccess: async (invite) => {
      setInviteError(null);
      const base = window.location.origin.replace(/\/+$/, "");
      const onboardingTextLink =
        invite.onboardingTextUrl ??
        invite.onboardingTextPath ??
        `/api/invites/${invite.token}/onboarding.txt`;
      const absoluteUrl = onboardingTextLink.startsWith("http")
        ? onboardingTextLink
        : `${base}${onboardingTextLink}`;
      setSnippetCopied(false);
      setSnippetCopyDelightId(0);
      let snippet: string;
      try {
        const manifest = await accessApi.getInviteOnboarding(invite.token);
        snippet = buildAgentSnippet({
          onboardingTextUrl: absoluteUrl,
          connectionCandidates:
            manifest.onboarding.connectivity?.connectionCandidates ?? null,
          testResolutionUrl:
            manifest.onboarding.connectivity?.testResolutionEndpoint?.url ??
            null
        });
      } catch {
        snippet = buildAgentSnippet({
          onboardingTextUrl: absoluteUrl,
          connectionCandidates: null,
          testResolutionUrl: null
        });
      }
      setInviteSnippet(snippet);
      try {
        await navigator.clipboard.writeText(snippet);
        setSnippetCopied(true);
        setSnippetCopyDelightId((prev) => prev + 1);
        setTimeout(() => setSnippetCopied(false), 2000);
      } catch {
        /* clipboard may not be available */
      }
      queryClient.invalidateQueries({
        queryKey: queryKeys.sidebarBadges(selectedCompanyId!)
      });
    },
    onError: (err) => {
      setInviteError(
        err instanceof Error ? err.message : "Failed to create invite"
      );
    }
  });

  const instanceSettingsQuery = useQuery({
    queryKey: queryKeys.instance.runtimeSettings,
    queryFn: () => instanceApi.getRuntimeSettings(),
    retry: false
  });

  const runtimeMutation = useMutation({
    mutationFn: (data: UpdateInstanceRuntimeSettings) =>
      instanceApi.updateRuntimeSettings(data),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.instance.runtimeSettings, settings);
      setSlackBotToken("");
      setSlackAppToken("");
      setSlackManifestToken("");
      setSlackSigningSecret("");
      setAuthPublicBaseUrl("");
      setSlackDefaultChannelMemberIds("");
      setSlackBoardApproverUserIds("");
      setBetterAuthSecret("");
    }
  });

  useEffect(() => {
    setInviteError(null);
    setInviteSnippet(null);
    setSnippetCopied(false);
    setSnippetCopyDelightId(0);
  }, [selectedCompanyId]);
  const archiveMutation = useMutation({
    mutationFn: ({
      companyId,
      nextCompanyId
    }: {
      companyId: string;
      nextCompanyId: string | null;
    }) => companiesApi.archive(companyId).then(() => ({ nextCompanyId })),
    onSuccess: async ({ nextCompanyId }) => {
      if (nextCompanyId) {
        setSelectedCompanyId(nextCompanyId);
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.all
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.stats
      });
    }
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Settings" }
    ]);
  }, [setBreadcrumbs, selectedCompany?.name]);

  if (!selectedCompany) {
    return (
      <div className="text-sm text-muted-foreground">
        No company selected. Select a company from the switcher above.
      </div>
    );
  }

  function handleSaveGeneral() {
    generalMutation.mutate({
      name: companyName.trim(),
      description: description.trim() || null,
      brandColor: brandColor || null
    });
  }

  const runtimeDirty =
    authPublicBaseUrl.trim().length > 0 ||
    slackDefaultChannelMemberIds.trim().length > 0 ||
    slackBoardApproverUserIds.trim().length > 0 ||
    slackBotToken.trim().length > 0 ||
    slackAppToken.trim().length > 0 ||
    slackManifestToken.trim().length > 0 ||
    slackSigningSecret.trim().length > 0 ||
    betterAuthSecret.trim().length > 0;

  function handleSaveRuntimeSecrets() {
    const data: UpdateInstanceRuntimeSettings = {};
    if (authPublicBaseUrl.trim()) {
      data.authPublicBaseUrl = authPublicBaseUrl.trim();
    }
    if (slackDefaultChannelMemberIds.trim()) {
      data.slackDefaultChannelMemberIds = slackDefaultChannelMemberIds.trim();
    }
    if (slackBoardApproverUserIds.trim()) {
      data.slackBoardApproverUserIds = slackBoardApproverUserIds.trim();
    }
    if (slackBotToken.trim()) {
      data.slackBotToken = slackBotToken.trim();
    }
    if (slackAppToken.trim()) {
      data.slackAppToken = slackAppToken.trim();
    }
    if (slackManifestToken.trim()) {
      data.slackManifestToken = slackManifestToken.trim();
    }
    if (slackSigningSecret.trim()) {
      data.slackSigningSecret = slackSigningSecret.trim();
    }
    if (betterAuthSecret.trim()) {
      data.betterAuthSecret = betterAuthSecret.trim();
    }
    runtimeMutation.mutate(data);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Company Settings</h1>
      </div>

      {/* General */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          General
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <Field label="Company name" hint="The display name for your company.">
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </Field>
          <Field
            label="Description"
            hint="Optional description shown in the company profile."
          >
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={description}
              placeholder="Optional company description"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {/* Appearance */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Appearance
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <CompanyPatternIcon
                companyName={companyName || selectedCompany.name}
                brandColor={brandColor || null}
                className="rounded-[14px]"
              />
            </div>
            <div className="flex-1 space-y-2">
              <Field
                label="Brand color"
                hint="Sets the hue for the company icon. Leave empty for auto-generated color."
              >
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={brandColor || "#6366f1"}
                    onChange={(e) => setBrandColor(e.target.value)}
                    className="h-8 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
                  />
                  <input
                    type="text"
                    value={brandColor}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || /^#[0-9a-fA-F]{0,6}$/.test(v)) {
                        setBrandColor(v);
                      }
                    }}
                    placeholder="Auto"
                    className="w-28 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                  />
                  {brandColor && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setBrandColor("")}
                      className="text-xs text-muted-foreground"
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </Field>
            </div>
          </div>
        </div>
      </div>

      {/* Save button for General + Appearance */}
      {generalDirty && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSaveGeneral}
            disabled={generalMutation.isPending || !companyName.trim()}
          >
            {generalMutation.isPending ? "Saving..." : "Save changes"}
          </Button>
          {generalMutation.isSuccess && (
            <span className="text-xs text-muted-foreground">Saved</span>
          )}
          {generalMutation.isError && (
            <span className="text-xs text-destructive">
              {generalMutation.error instanceof Error
                ? generalMutation.error.message
                : "Failed to save"}
            </span>
          )}
        </div>
      )}

      {/* Instance Runtime */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Instance Runtime
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="space-y-1">
            <div className="text-sm font-medium">Runtime connectivity and Slack settings</div>
            <p className="text-xs text-muted-foreground">
              These values are saved to the global OrchestorAI instance env file
              under your OrchestorAI home directory and apply to the whole runtime.
            </p>
            {instanceSettingsQuery.data?.envFilePath && (
              <p className="text-xs text-muted-foreground">
                Env file:{" "}
                <span className="font-mono">
                  {instanceSettingsQuery.data.envFilePath}
                </span>
              </p>
            )}
          </div>

          {instanceSettingsQuery.isLoading && (
            <p className="text-sm text-muted-foreground">
              Loading instance runtime settings...
            </p>
          )}
          {instanceSettingsQuery.isError && (
            <p className="text-sm text-destructive">
              {instanceSettingsQuery.error instanceof Error
                ? instanceSettingsQuery.error.message
                : "Failed to load instance runtime settings"}
            </p>
          )}

          {instanceSettingsQuery.data && (
            <>
              <Field
                label="Public base URL"
                hint="The externally reachable OrchestorAI base URL used for Slack OAuth callbacks and Slack event delivery. Saved as ORCHESTORAI_AUTH_PUBLIC_BASE_URL."
              >
                <input
                  className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                  type="url"
                  value={authPublicBaseUrl}
                  placeholder={
                    instanceSettingsQuery.data.authPublicBaseUrl.value ??
                    "https://orchestorai.example.com"
                  }
                  onChange={(e) => setAuthPublicBaseUrl(e.target.value)}
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                {describeRuntimeValue(instanceSettingsQuery.data.authPublicBaseUrl)}
              </p>

              <Field
                label="SLACK_DEFAULT_CHANNEL_MEMBER_IDS"
                hint="Comma-separated Slack member IDs to auto-invite into every new or resynced project channel. Saved as SLACK_DEFAULT_CHANNEL_MEMBER_IDS in the global OrchestorAI env file."
              >
                <input
                  className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                  type="text"
                  value={slackDefaultChannelMemberIds}
                  placeholder={
                    instanceSettingsQuery.data.slackDefaultChannelMemberIds.value ??
                    "U01234567,U089ABCDE"
                  }
                  onChange={(e) => setSlackDefaultChannelMemberIds(e.target.value)}
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                {describeRuntimeValue(
                  instanceSettingsQuery.data.slackDefaultChannelMemberIds
                )}
              </p>

              <Field
                label="SLACK_BOARD_APPROVER_USER_IDS"
                hint="Comma-separated Slack user IDs allowed to approve or reject host command fallback requests from Slack threads. If unset, OrchestorAI falls back to SLACK_DEFAULT_CHANNEL_MEMBER_IDS."
              >
                <input
                  className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                  type="text"
                  value={slackBoardApproverUserIds}
                  placeholder={
                    instanceSettingsQuery.data.slackBoardApproverUserIds.value ??
                    "U01234567,U089ABCDE"
                  }
                  onChange={(e) => setSlackBoardApproverUserIds(e.target.value)}
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                {describeRuntimeValue(
                  instanceSettingsQuery.data.slackBoardApproverUserIds
                )}
              </p>

              <Field
                label="SLACK_BOT_TOKEN"
                hint="Required for the shared Slack control app to create project channels, invite agent bots, and post shared Slack updates."
              >
                <input
                  className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                  type="password"
                  value={slackBotToken}
                  placeholder={
                    instanceSettingsQuery.data.secrets.slackBotToken
                      .maskedValue ?? "Not configured"
                  }
                  onChange={(e) => setSlackBotToken(e.target.value)}
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                {describeRuntimeSecret(
                  instanceSettingsQuery.data.secrets.slackBotToken
                )}
              </p>

              <Field
                label="SLACK_APP_TOKEN (legacy)"
                hint="Only needed for the older socket-mode Slack bot. The new project-channel Slack flow does not use this token."
              >
                <input
                  className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                  type="password"
                  value={slackAppToken}
                  placeholder={
                    instanceSettingsQuery.data.secrets.slackAppToken
                      .maskedValue ?? "Not configured"
                  }
                  onChange={(e) => setSlackAppToken(e.target.value)}
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                {describeRuntimeSecret(
                  instanceSettingsQuery.data.secrets.slackAppToken
                )}
              </p>

              <Field
                label="SLACK_APP_MANIFEST_TOKEN"
                hint="Required for automatic per-agent Slack app creation via Slack app manifests."
              >
                <input
                  className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                  type="password"
                  value={slackManifestToken}
                  placeholder={
                    instanceSettingsQuery.data.secrets.slackManifestToken
                      .maskedValue ?? "Not configured"
                  }
                  onChange={(e) => setSlackManifestToken(e.target.value)}
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                {describeRuntimeSecret(
                  instanceSettingsQuery.data.secrets.slackManifestToken
                )}
              </p>

              <Field
                label="SLACK_SIGNING_SECRET"
                hint="Required for OrchestorAI to receive verified message events from the shared control Slack app."
              >
                <input
                  className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                  type="password"
                  value={slackSigningSecret}
                  placeholder={
                    instanceSettingsQuery.data.secrets.slackSigningSecret
                      .maskedValue ?? "Not configured"
                  }
                  onChange={(e) => setSlackSigningSecret(e.target.value)}
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                {describeRuntimeSecret(
                  instanceSettingsQuery.data.secrets.slackSigningSecret
                )}
              </p>

              <Field
                label="BETTER_AUTH_SECRET"
                hint="Required for authenticated mode. Changing it invalidates current auth sessions after restart."
              >
                <input
                  className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                  type="password"
                  value={betterAuthSecret}
                  placeholder={
                    instanceSettingsQuery.data.secrets.betterAuthSecret
                      .maskedValue ?? "Not configured"
                  }
                  onChange={(e) => setBetterAuthSecret(e.target.value)}
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                {describeRuntimeSecret(
                  instanceSettingsQuery.data.secrets.betterAuthSecret
                )}
              </p>

              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
                Restart OrchestorAI after saving these values. The public base URL,
                auth secret, and integrated Slack credentials are loaded at startup.
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleSaveRuntimeSecrets}
                  disabled={runtimeMutation.isPending || !runtimeDirty}
                >
                  {runtimeMutation.isPending
                    ? "Saving..."
                    : "Save runtime settings"}
                </Button>
                {runtimeMutation.isSuccess && (
                  <span className="text-xs text-muted-foreground">
                    Saved to the global OrchestorAI env file
                  </span>
                )}
                {runtimeMutation.isError && (
                  <span className="text-xs text-destructive">
                    {runtimeMutation.error instanceof Error
                      ? runtimeMutation.error.message
                      : "Failed to save runtime secrets"}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <SocialRoomSettingsSection
        companyId={selectedCompany.id}
        companyName={selectedCompany.name}
      />

      {/* Hiring */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Hiring
        </div>
        <div className="rounded-md border border-border px-4 py-3">
          <ToggleField
            label="Require board approval for new hires"
            hint="New agent hires stay pending until approved by board."
            checked={!!selectedCompany.requireBoardApprovalForNewAgents}
            onChange={(v) => settingsMutation.mutate(v)}
          />
        </div>
      </div>

      {/* Invites */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Invites
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
              Generate an agent snippet for join flows.
            </span>
            <HintIcon text="Creates an agent-only invite (10m) and renders a copy-ready snippet." />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => inviteMutation.mutate()}
              disabled={inviteMutation.isPending}
            >
              {inviteMutation.isPending
                ? "Generating..."
                : "Generate agent snippet"}
            </Button>
          </div>
          {inviteError && (
            <p className="text-sm text-destructive">{inviteError}</p>
          )}
          {inviteSnippet && (
            <div className="rounded-md border border-border bg-muted/30 p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  Agent Snippet
                </div>
                {snippetCopied && (
                  <span
                    key={snippetCopyDelightId}
                    className="flex items-center gap-1 text-xs text-green-600 animate-pulse"
                  >
                    <Check className="h-3 w-3" />
                    Copied
                  </span>
                )}
              </div>
              <div className="mt-1 space-y-1.5">
                <textarea
                  className="h-[28rem] w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none"
                  value={inviteSnippet}
                  readOnly
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(inviteSnippet);
                        setSnippetCopied(true);
                        setSnippetCopyDelightId((prev) => prev + 1);
                        setTimeout(() => setSnippetCopied(false), 2000);
                      } catch {
                        /* clipboard may not be available */
                      }
                    }}
                  >
                    {snippetCopied ? "Copied snippet" : "Copy snippet"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-destructive uppercase tracking-wide">
          Danger Zone
        </div>
        <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Archive this company to hide it from the sidebar. This persists in
            the database.
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={
                archiveMutation.isPending ||
                selectedCompany.status === "archived"
              }
              onClick={() => {
                if (!selectedCompanyId) return;
                const confirmed = window.confirm(
                  `Archive company "${selectedCompany.name}"? It will be hidden from the sidebar.`
                );
                if (!confirmed) return;
                const nextCompanyId =
                  companies.find(
                    (company) =>
                      company.id !== selectedCompanyId &&
                      company.status !== "archived"
                  )?.id ?? null;
                archiveMutation.mutate({
                  companyId: selectedCompanyId,
                  nextCompanyId
                });
              }}
            >
              {archiveMutation.isPending
                ? "Archiving..."
                : selectedCompany.status === "archived"
                ? "Already archived"
                : "Archive company"}
            </Button>
            {archiveMutation.isError && (
              <span className="text-xs text-destructive">
                {archiveMutation.error instanceof Error
                  ? archiveMutation.error.message
                  : "Failed to archive company"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function describeRuntimeSecret(secret: InstanceRuntimeSecretStatus) {
  if (!secret.configured) {
    return `${secret.envKey} is not configured yet.`;
  }

  if (secret.source === "orchestorai_env") {
    return `${secret.envKey} is currently sourced from the global OrchestorAI env file (${secret.maskedValue}).`;
  }

  if (secret.source === "process_env") {
    return `${secret.envKey} is currently only present in the process environment (${secret.maskedValue}). Saving here will move it into the global OrchestorAI env file.`;
  }

  return `${secret.envKey} is configured (${secret.maskedValue}).`;
}

function describeRuntimeValue(setting: InstanceRuntimeValueStatus) {
  if (!setting.configured) {
    return `${setting.envKey} is not configured yet.`;
  }

  if (setting.source === "orchestorai_env") {
    return `${setting.envKey} is currently sourced from the global OrchestorAI env file (${setting.value}).`;
  }

  if (setting.source === "process_env") {
    return `${setting.envKey} is currently only present in the process environment (${setting.value}). Saving here will move it into the global OrchestorAI env file.`;
  }

  if (setting.source === "config_file") {
    return `${setting.envKey} currently falls back to the OrchestorAI config file (${setting.value}). Saving here will override it in the global OrchestorAI env file.`;
  }

  return `${setting.envKey} is configured (${setting.value}).`;
}

function buildAgentSnippet(input: AgentSnippetInput) {
  const candidateUrls = buildCandidateOnboardingUrls(input);
  const resolutionTestUrl = buildResolutionTestUrl(input);

  const candidateList =
    candidateUrls.length > 0
      ? candidateUrls.map((u) => `- ${u}`).join("\n")
      : "- (No candidate URLs available yet.)";

  const connectivityBlock =
    candidateUrls.length === 0
      ? `No candidate URLs are available. Ask your user to configure a reachable hostname in OrchestorAI, then retry.
Suggested steps:
- choose a hostname that resolves to the OrchestorAI host from your runtime
- run: pnpm orchestorai allowed-hostname <host>
- restart OrchestorAI
- verify with: curl -fsS http://<host>:3100/api/health
- regenerate this invite snippet`
      : `If none are reachable, ask your user to add a reachable hostname in OrchestorAI, restart, and retry.
Suggested command:
- pnpm orchestorai allowed-hostname <host>
Then verify with: curl -fsS <base-url>/api/health`;

  const resolutionLine = resolutionTestUrl
    ? `\nYou MUST test callback reachability, call: ${resolutionTestUrl}?url=<urlencoded-webhook-url> (well using the hostname that worked above). Do not assume your 172.x is necessarily reachable from OrchestorAI. Test it. `
    : "";

  return `You're invited to join a OrchestorAI organization.

The URLs you should try are:
${candidateList}

Connectivity guidance:
If you are running on a different machine than OrchestorAI, OrchestorAI must be reachable at one of the hostnames used above.
Verify the hostname works from your runtime with: GET <base-url>/api/health

${connectivityBlock}

For your "agentName", just use your own agent name (OpenClaw or whatever your name is) and send it directly.
You also need to send a webhook URL that OrchestorAI can access. Check your config and include that URL.${resolutionLine}

---

In order for OrchestorAI to work smoothly, you need to enable \`gateway.http.endpoints.responses.enabled=true\` in your OpenClaw config.

Please enable that setting and notify your user that we did so.

Before you do anything, please respond to your user that you understand the instructions and you're going to work on them. Then do the step above in another session called "orchestorai-onboarding" and then tell your user when you're done. Update your user in intermediate steps along the way so they know what's going on.

Then after you've connected to OrchestorAI (exchanged keys etc.) you MUST review and follow the onboarding instructions in onboarding.txt they give you.

`;
}

function buildCandidateOnboardingUrls(input: AgentSnippetInput): string[] {
  const candidates = (input.connectionCandidates ?? [])
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  const urls = new Set<string>();
  let onboardingUrl: URL | null = null;

  try {
    onboardingUrl = new URL(input.onboardingTextUrl);
    urls.add(onboardingUrl.toString());
  } catch {
    const trimmed = input.onboardingTextUrl.trim();
    if (trimmed) {
      urls.add(trimmed);
    }
  }

  if (!onboardingUrl) {
    for (const candidate of candidates) {
      urls.add(candidate);
    }
    return Array.from(urls);
  }

  const onboardingPath = `${onboardingUrl.pathname}${onboardingUrl.search}`;
  for (const candidate of candidates) {
    try {
      const base = new URL(candidate);
      urls.add(`${base.origin}${onboardingPath}`);
    } catch {
      urls.add(candidate);
    }
  }

  return Array.from(urls);
}

function buildResolutionTestUrl(input: AgentSnippetInput): string | null {
  const explicit = input.testResolutionUrl?.trim();
  if (explicit) return explicit;

  try {
    const onboardingUrl = new URL(input.onboardingTextUrl);
    const testPath = onboardingUrl.pathname.replace(
      /\/onboarding\.txt$/,
      "/test-resolution"
    );
    return `${onboardingUrl.origin}${testPath}`;
  } catch {
    return null;
  }
}
