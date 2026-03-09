import type {
  ProjectSlackChannelStatus,
  ProjectSlackChannelVisibility,
  ProjectStatus,
} from "../constants.js";

export interface ProjectMember {
  id: string;
  companyId: string;
  projectId: string;
  agentId: string;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectSlackChannelSummary {
  id: string;
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

export interface ProjectGoalRef {
  id: string;
  title: string;
}

export interface ProjectWorkspace {
  id: string;
  companyId: string;
  projectId: string;
  name: string;
  cwd: string | null;
  repoUrl: string | null;
  repoRef: string | null;
  metadata: Record<string, unknown> | null;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: string;
  companyId: string;
  urlKey: string;
  /** @deprecated Use goalIds / goals instead */
  goalId: string | null;
  goalIds: string[];
  goals: ProjectGoalRef[];
  name: string;
  description: string | null;
  issuePrefix: string | null;
  issueCounter: number;
  status: ProjectStatus;
  leadAgentId: string | null;
  targetDate: string | null;
  color: string | null;
  slackChannelVisibility: ProjectSlackChannelVisibility;
  slackChannelName: string | null;
  metadata: Record<string, unknown> | null;
  members: ProjectMember[];
  slackChannel: ProjectSlackChannelSummary | null;
  workspaces: ProjectWorkspace[];
  primaryWorkspace: ProjectWorkspace | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
