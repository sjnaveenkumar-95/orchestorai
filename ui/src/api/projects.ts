import type {
  Project,
  ProjectMember,
  ProjectSlackState,
  ProjectWorkspace,
} from "@orchestorai/shared";
import { api } from "./client";

function withCompanyScope(path: string, companyId?: string) {
  if (!companyId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}companyId=${encodeURIComponent(companyId)}`;
}

function projectPath(id: string, companyId?: string, suffix = "") {
  return withCompanyScope(`/projects/${encodeURIComponent(id)}${suffix}`, companyId);
}

export const projectsApi = {
  list: (companyId: string) => api.get<Project[]>(`/companies/${companyId}/projects`),
  get: (id: string, companyId?: string) => api.get<Project>(projectPath(id, companyId)),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<Project>(`/companies/${companyId}/projects`, data),
  update: (id: string, data: Record<string, unknown>, companyId?: string) =>
    api.patch<Project>(projectPath(id, companyId), data),
  listWorkspaces: (projectId: string, companyId?: string) =>
    api.get<ProjectWorkspace[]>(projectPath(projectId, companyId, "/workspaces")),
  listMembers: (projectId: string, companyId?: string) =>
    api.get<ProjectMember[]>(projectPath(projectId, companyId, "/members")),
  addMember: (projectId: string, data: { agentId: string }, companyId?: string) =>
    api.post<ProjectMember>(projectPath(projectId, companyId, "/members"), data),
  removeMember: (projectId: string, agentId: string, companyId?: string) =>
    api.delete<ProjectMember>(projectPath(projectId, companyId, `/members/${encodeURIComponent(agentId)}`)),
  getSlackState: (projectId: string, companyId?: string) =>
    api.get<ProjectSlackState>(projectPath(projectId, companyId, "/slack")),
  syncSlack: (projectId: string, companyId?: string) =>
    api.post<ProjectSlackState>(projectPath(projectId, companyId, "/slack/sync"), {}),
  archiveSlack: (projectId: string, companyId?: string) =>
    api.post<ProjectSlackState>(projectPath(projectId, companyId, "/slack/archive"), {}),
  createWorkspace: (projectId: string, data: Record<string, unknown>, companyId?: string) =>
    api.post<ProjectWorkspace>(projectPath(projectId, companyId, "/workspaces"), data),
  updateWorkspace: (projectId: string, workspaceId: string, data: Record<string, unknown>, companyId?: string) =>
    api.patch<ProjectWorkspace>(
      projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}`),
      data,
    ),
  removeWorkspace: (projectId: string, workspaceId: string, companyId?: string) =>
    api.delete<ProjectWorkspace>(projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}`)),
  remove: (id: string, companyId?: string) => api.delete<Project>(projectPath(id, companyId)),
};
