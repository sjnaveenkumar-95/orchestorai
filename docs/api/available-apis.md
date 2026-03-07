---
title: Available APIs
summary: Source-derived HTTP endpoint inventory for the current Paperclip server
---

# Available APIs

This file is a source-derived index of the HTTP endpoints mounted by [app.ts](/Users/naveenkumar/Workspace/AI/AGI/paperclip/server/src/app.ts) and [server/src/routes](/Users/naveenkumar/Workspace/AI/AGI/paperclip/server/src/routes).

Base URLs:

- Current local run: `http://127.0.0.1:3101`
- Current local API base: `http://127.0.0.1:3101/api`
- Generic API prefix in code/docs: `/api`
- LLM reflection endpoints are mounted under `/llms` and are not prefixed with `/api`

This is an endpoint index, not a full schema reference. For request/response details, see the existing docs under [docs/api](/Users/naveenkumar/Workspace/AI/AGI/paperclip/docs/api).

## Authentication and Session

- `GET /api/auth/get-session`
- `ALL /api/auth/*authPath` - Better Auth session routes when authenticated mode is enabled

## Health

- `GET /api/health`

## Companies

- `GET /api/companies`
- `GET /api/companies/stats`
- `GET /api/companies/{companyId}`
- `POST /api/companies`
- `PATCH /api/companies/{companyId}`
- `POST /api/companies/{companyId}/archive`
- `DELETE /api/companies/{companyId}`
- `POST /api/companies/{companyId}/export`
- `POST /api/companies/import/preview`
- `POST /api/companies/import`
- `GET /api/companies/issues` - malformed-path guard that returns an error explaining the missing `{companyId}`

## Goals

- `GET /api/companies/{companyId}/goals`
- `GET /api/goals/{goalId}`
- `POST /api/companies/{companyId}/goals`
- `PATCH /api/goals/{goalId}`
- `DELETE /api/goals/{goalId}`

## Projects and Workspaces

- `GET /api/companies/{companyId}/projects`
- `GET /api/projects/{projectId}`
- `POST /api/companies/{companyId}/projects`
- `PATCH /api/projects/{projectId}`
- `DELETE /api/projects/{projectId}`
- `GET /api/projects/{projectId}/workspaces`
- `POST /api/projects/{projectId}/workspaces`
- `PATCH /api/projects/{projectId}/workspaces/{workspaceId}`
- `DELETE /api/projects/{projectId}/workspaces/{workspaceId}`

## Issues, Labels, Comments, and Attachments

- `GET /api/companies/{companyId}/issues`
- `POST /api/companies/{companyId}/issues`
- `GET /api/issues/{issueId}`
- `PATCH /api/issues/{issueId}`
- `DELETE /api/issues/{issueId}`
- `POST /api/issues/{issueId}/read`
- `POST /api/issues/{issueId}/checkout`
- `POST /api/issues/{issueId}/release`
- `GET /api/issues/{issueId}/comments`
- `GET /api/issues/{issueId}/comments/{commentId}`
- `POST /api/issues/{issueId}/comments`
- `GET /api/companies/{companyId}/labels`
- `POST /api/companies/{companyId}/labels`
- `DELETE /api/labels/{labelId}`
- `GET /api/issues/{issueId}/attachments`
- `POST /api/companies/{companyId}/issues/{issueId}/attachments`
- `GET /api/attachments/{attachmentId}/content`
- `DELETE /api/attachments/{attachmentId}`

## Approvals

- `GET /api/companies/{companyId}/approvals`
- `GET /api/approvals/{approvalId}`
- `POST /api/companies/{companyId}/approvals`
- `GET /api/approvals/{approvalId}/issues`
- `POST /api/approvals/{approvalId}/approve`
- `POST /api/approvals/{approvalId}/reject`
- `POST /api/approvals/{approvalId}/request-revision`
- `POST /api/approvals/{approvalId}/resubmit`
- `GET /api/approvals/{approvalId}/comments`
- `POST /api/approvals/{approvalId}/comments`
- `GET /api/issues/{issueId}/approvals`
- `POST /api/issues/{issueId}/approvals`
- `DELETE /api/issues/{issueId}/approvals/{approvalId}`

## Agents, Org, and Adapter Configuration

- `GET /api/companies/{companyId}/agents`
- `POST /api/companies/{companyId}/agents`
- `POST /api/companies/{companyId}/agent-hires`
- `GET /api/companies/{companyId}/org`
- `GET /api/companies/{companyId}/agent-configurations`
- `GET /api/companies/{companyId}/adapters/{type}/models`
- `POST /api/companies/{companyId}/adapters/{type}/test-environment`
- `GET /api/agents/me`
- `GET /api/agents/{agentId}`
- `PATCH /api/agents/{agentId}`
- `DELETE /api/agents/{agentId}`
- `PATCH /api/agents/{agentId}/permissions`
- `PATCH /api/agents/{agentId}/instructions-path`
- `POST /api/agents/{agentId}/pause`
- `POST /api/agents/{agentId}/resume`
- `POST /api/agents/{agentId}/terminate`
- `GET /api/agents/{agentId}/configuration`
- `GET /api/agents/{agentId}/config-revisions`
- `GET /api/agents/{agentId}/config-revisions/{revisionId}`
- `POST /api/agents/{agentId}/config-revisions/{revisionId}/rollback`

## Agent Runtime, Keys, and Heartbeats

- `GET /api/agents/{agentId}/runtime-state`
- `POST /api/agents/{agentId}/runtime-state/reset-session`
- `GET /api/agents/{agentId}/task-sessions`
- `GET /api/agents/{agentId}/keys`
- `POST /api/agents/{agentId}/keys`
- `DELETE /api/agents/{agentId}/keys/{keyId}`
- `POST /api/agents/{agentId}/wakeup`
- `POST /api/agents/{agentId}/heartbeat/invoke`
- `POST /api/agents/{agentId}/claude-login`
- `GET /api/companies/{companyId}/heartbeat-runs`
- `GET /api/companies/{companyId}/live-runs`
- `POST /api/heartbeat-runs/{runId}/cancel`
- `GET /api/heartbeat-runs/{runId}/events`
- `GET /api/heartbeat-runs/{runId}/log`
- `GET /api/issues/{issueId}/live-runs`
- `GET /api/issues/{issueId}/active-run`

## Activity, Dashboard, and UI Helpers

- `GET /api/companies/{companyId}/activity`
- `POST /api/companies/{companyId}/activity`
- `GET /api/issues/{issueId}/activity`
- `GET /api/issues/{issueId}/runs`
- `GET /api/heartbeat-runs/{runId}/issues`
- `GET /api/companies/{companyId}/dashboard`
- `GET /api/companies/{companyId}/sidebar-badges`

## Costs and Budgets

- `POST /api/companies/{companyId}/cost-events`
- `GET /api/companies/{companyId}/costs/summary`
- `GET /api/companies/{companyId}/costs/by-agent`
- `GET /api/companies/{companyId}/costs/by-project`
- `PATCH /api/companies/{companyId}/budgets`
- `PATCH /api/agents/{agentId}/budgets`

## Secrets

- `GET /api/companies/{companyId}/secret-providers`
- `GET /api/companies/{companyId}/secrets`
- `POST /api/companies/{companyId}/secrets`
- `POST /api/secrets/{secretId}/rotate`
- `PATCH /api/secrets/{secretId}`
- `DELETE /api/secrets/{secretId}`

## Assets

- `POST /api/companies/{companyId}/assets/images`
- `GET /api/assets/{assetId}/content`

## Access, Invites, Join Requests, and Membership

- `GET /api/board-claim/{token}`
- `POST /api/board-claim/{token}/claim`
- `GET /api/skills/index`
- `GET /api/skills/{skillName}`
- `POST /api/companies/{companyId}/invites`
- `GET /api/invites/{token}`
- `GET /api/invites/{token}/onboarding`
- `GET /api/invites/{token}/onboarding.txt`
- `GET /api/invites/{token}/test-resolution`
- `POST /api/invites/{token}/accept`
- `POST /api/invites/{inviteId}/revoke`
- `GET /api/companies/{companyId}/join-requests`
- `POST /api/companies/{companyId}/join-requests/{requestId}/approve`
- `POST /api/companies/{companyId}/join-requests/{requestId}/reject`
- `POST /api/join-requests/{requestId}/claim-api-key`
- `GET /api/companies/{companyId}/members`
- `PATCH /api/companies/{companyId}/members/{memberId}/permissions`
- `POST /api/admin/users/{userId}/promote-instance-admin`
- `POST /api/admin/users/{userId}/demote-instance-admin`
- `GET /api/admin/users/{userId}/company-access`
- `PUT /api/admin/users/{userId}/company-access`

## LLM Reflection Endpoints

- `GET /llms/agent-configuration.txt`
- `GET /llms/agent-icons.txt`
- `GET /llms/agent-configuration/{adapterType}.txt`

## Source Notes

- Route mount points: [app.ts](/Users/naveenkumar/Workspace/AI/AGI/paperclip/server/src/app.ts)
- Route implementations: [server/src/routes](/Users/naveenkumar/Workspace/AI/AGI/paperclip/server/src/routes)
- Existing prose docs: [docs/api](/Users/naveenkumar/Workspace/AI/AGI/paperclip/docs/api)
