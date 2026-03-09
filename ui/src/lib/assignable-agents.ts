type ProjectMemberRef = {
  agentId: string;
};

type AgentRef = {
  id: string;
  status?: string | null;
};

export function getProjectMemberAgentIds(
  members: readonly ProjectMemberRef[] | null | undefined,
): string[] {
  return Array.from(
    new Set(
      (members ?? [])
        .map((member) => member.agentId)
        .filter((agentId): agentId is string => agentId.length > 0),
    ),
  );
}

export function filterAssignableAgents<T extends AgentRef>(
  agents: readonly T[] | null | undefined,
  projectMemberAgentIds: readonly string[] | null | undefined,
): T[] {
  const activeAgents = (agents ?? []).filter((agent) => agent.status !== "terminated");
  if (projectMemberAgentIds == null) {
    return [...activeAgents];
  }
  const allowedAgentIds = new Set(projectMemberAgentIds);
  return activeAgents.filter((agent) => allowedAgentIds.has(agent.id));
}

export function isAgentAssignableToProject(
  agentId: string | null | undefined,
  projectMemberAgentIds: readonly string[] | null | undefined,
): boolean {
  if (!agentId || projectMemberAgentIds == null) {
    return true;
  }
  return new Set(projectMemberAgentIds).has(agentId);
}
