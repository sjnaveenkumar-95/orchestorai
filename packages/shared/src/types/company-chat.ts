import type {
  CompanyChatCompletionAssessment,
  CompanyChatMessageAuthorType,
  CompanyChatMessageSource,
  CompanyChatRoomStatus,
  CompanyChatThreadOrigin,
  CompanyChatThreadStatus,
} from "../constants.js";

export interface CompanyChatTopic {
  slug: string;
  label: string;
  description: string | null;
  autonomousAllowed: boolean;
  internetAllowed: boolean;
}

export interface CompanyChatRoom {
  id: string;
  companyId: string;
  displayName: string;
  slackChannelId: string | null;
  slackChannelName: string | null;
  status: CompanyChatRoomStatus;
  enabled: boolean;
  idleThresholdHours: number;
  maxAutonomousThreads: number;
  autonomousStartEnabled: boolean;
  allowedTopics: CompanyChatTopic[];
  chatBudgetMonthlyCents: number;
  chatSpentMonthlyCents: number;
  promptPackDir: string | null;
  promptSystemPath: string | null;
  promptAgentsPath: string | null;
  promptSoulPath: string | null;
  lastRoomActivityAt: Date | null;
  lastError: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompanyChatPromptPack {
  roomId: string;
  companyId: string;
  directory: string;
  systemPath: string;
  agentsPath: string;
  soulPath: string;
  system: string;
  agents: string;
  soul: string;
}

export interface CompanyChatThread {
  id: string;
  companyId: string;
  roomId: string;
  topic: string | null;
  origin: CompanyChatThreadOrigin;
  autonomous: boolean;
  initiatedByAgentId: string | null;
  initiatedByUserId: string | null;
  slackChannelId: string | null;
  slackThreadTs: string | null;
  status: CompanyChatThreadStatus;
  completionAssessment: CompanyChatCompletionAssessment;
  lastActivityAt: Date;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompanyChatMessage {
  id: string;
  companyId: string;
  roomId: string;
  threadId: string;
  authorType: CompanyChatMessageAuthorType;
  authorAgentId: string | null;
  authorUserId: string | null;
  source: CompanyChatMessageSource;
  slackChannelId: string | null;
  slackMessageTs: string | null;
  text: string;
  internetBacked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompanyChatReaction {
  id: string;
  companyId: string;
  roomId: string;
  threadId: string;
  messageId: string;
  authorType: CompanyChatMessageAuthorType;
  authorAgentId: string | null;
  authorUserId: string | null;
  source: CompanyChatMessageSource;
  slackChannelId: string | null;
  slackMessageTs: string | null;
  emoji: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompanyChatParticipation {
  id: string;
  companyId: string;
  roomId: string;
  agentId: string;
  messageCount: number;
  autonomousStartsCount: number;
  lastParticipatedAt: Date | null;
  lastAutonomousStartedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
