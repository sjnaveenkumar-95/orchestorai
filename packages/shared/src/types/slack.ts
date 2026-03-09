import type {
  AgentSlackAppInstallStatus,
  ProjectSlackChannelStatus,
  ProjectSlackChannelVisibility,
  ProjectSlackMembershipSyncStatus,
} from "../constants.js";

export interface AgentSlackApp {
  id: string;
  companyId: string;
  agentId: string;
  slackAppId: string | null;
  clientId: string | null;
  botUserId: string | null;
  teamId: string | null;
  installStatus: AgentSlackAppInstallStatus;
  installUrl: string | null;
  oauthState: string | null;
  clientSecretSecretId: string | null;
  botTokenSecretId: string | null;
  signingSecretSecretId: string | null;
  lastError: string | null;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectSlackChannel {
  id: string;
  companyId: string;
  projectId: string;
  channelId: string | null;
  channelName: string | null;
  visibility: ProjectSlackChannelVisibility;
  status: ProjectSlackChannelStatus;
  lastError: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectSlackMembership {
  id: string;
  companyId: string;
  projectId: string;
  projectSlackChannelId: string | null;
  agentId: string;
  agentSlackAppId: string | null;
  syncStatus: ProjectSlackMembershipSyncStatus;
  lastError: string | null;
  syncedAt: Date | null;
  removedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectSlackMembershipState extends ProjectSlackMembership {
  agentSlackApp: AgentSlackApp | null;
}

export interface ProjectSlackState {
  channel: ProjectSlackChannel | null;
  memberships: ProjectSlackMembershipState[];
}

export interface SlackThreadLink {
  id: string;
  companyId: string;
  issueId: string;
  projectId: string | null;
  projectSlackChannelId: string | null;
  channelId: string;
  threadTs: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
