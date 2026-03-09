import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  goals,
  projectGoals,
  projectMembers,
  projectSlackChannels,
  projectWorkspaces,
  projects,
} from "@paperclipai/db";
import {
  PROJECT_COLORS,
  deriveProjectUrlKey,
  isUuidLike,
  normalizeProjectUrlKey,
  readReferenceAliases,
  type ReferenceAliases,
  type ProjectGoalRef,
  type ProjectMember,
  type ProjectSlackChannelSummary,
  type ProjectWorkspace,
} from "@paperclipai/shared";
import {
  applyResolvedReferenceAliases,
  resolveEntityReferenceAliases,
  stripResolvedReferenceAliases,
} from "./reference-aliases.js";

type ProjectRow = typeof projects.$inferSelect;
type ProjectWorkspaceRow = typeof projectWorkspaces.$inferSelect;
const REPO_ONLY_CWD_SENTINEL = "/__paperclip_repo_only__";
type CreateWorkspaceInput = {
  name?: string | null;
  cwd?: string | null;
  repoUrl?: string | null;
  repoRef?: string | null;
  metadata?: Record<string, unknown> | null;
  isPrimary?: boolean;
};
type UpdateWorkspaceInput = Partial<CreateWorkspaceInput>;

interface ProjectWithGoals extends ProjectRow {
  urlKey: string;
  goalIds: string[];
  goals: ProjectGoalRef[];
  members: ProjectMember[];
  slackChannel: ProjectSlackChannelSummary | null;
  workspaces: ProjectWorkspace[];
  primaryWorkspace: ProjectWorkspace | null;
}

interface ProjectReferenceRow {
  id: string;
  name: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

/** Batch-load goal refs for a set of projects. */
async function attachGoals(db: Db, rows: ProjectRow[]): Promise<ProjectWithGoals[]> {
  if (rows.length === 0) return [];

  const projectIds = rows.map((r) => r.id);

  // Fetch join rows + goal titles in one query
  const links = await db
    .select({
      projectId: projectGoals.projectId,
      goalId: projectGoals.goalId,
      goalTitle: goals.title,
    })
    .from(projectGoals)
    .innerJoin(goals, eq(projectGoals.goalId, goals.id))
    .where(inArray(projectGoals.projectId, projectIds));

  const map = new Map<string, ProjectGoalRef[]>();
  for (const link of links) {
    let arr = map.get(link.projectId);
    if (!arr) {
      arr = [];
      map.set(link.projectId, arr);
    }
    arr.push({ id: link.goalId, title: link.goalTitle });
  }

  return rows.map((r) => {
    const g = map.get(r.id) ?? [];
    return {
      ...r,
      urlKey: deriveProjectUrlKey(r.name, r.id),
      goalIds: g.map((x) => x.id),
      goals: g,
    } as ProjectWithGoals;
  });
}

function toWorkspace(row: ProjectWorkspaceRow): ProjectWorkspace {
  return {
    id: row.id,
    companyId: row.companyId,
    projectId: row.projectId,
    name: row.name,
    cwd: row.cwd,
    repoUrl: row.repoUrl ?? null,
    repoRef: row.repoRef ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    isPrimary: row.isPrimary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function pickPrimaryWorkspace(rows: ProjectWorkspaceRow[]): ProjectWorkspace | null {
  if (rows.length === 0) return null;
  const explicitPrimary = rows.find((row) => row.isPrimary);
  return toWorkspace(explicitPrimary ?? rows[0]);
}

function toProjectSlackChannelSummary(
  row: typeof projectSlackChannels.$inferSelect,
): ProjectSlackChannelSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    channelId: row.channelId,
    channelName: row.channelName,
    visibility: row.visibility as ProjectSlackChannelSummary["visibility"],
    status: row.status as ProjectSlackChannelSummary["status"],
    lastError: row.lastError,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Batch-load workspace refs for a set of projects. */
async function attachWorkspaces(db: Db, rows: ProjectWithGoals[]): Promise<ProjectWithGoals[]> {
  if (rows.length === 0) return [];

  const projectIds = rows.map((r) => r.id);
  const workspaceRows = await db
    .select()
    .from(projectWorkspaces)
    .where(inArray(projectWorkspaces.projectId, projectIds))
    .orderBy(desc(projectWorkspaces.isPrimary), asc(projectWorkspaces.createdAt), asc(projectWorkspaces.id));

  const map = new Map<string, ProjectWorkspaceRow[]>();
  for (const row of workspaceRows) {
    let arr = map.get(row.projectId);
    if (!arr) {
      arr = [];
      map.set(row.projectId, arr);
    }
    arr.push(row);
  }

  return rows.map((row) => {
    const projectWorkspaceRows = map.get(row.id) ?? [];
    const workspaces = projectWorkspaceRows.map(toWorkspace);
    return {
      ...row,
      workspaces,
      primaryWorkspace: pickPrimaryWorkspace(projectWorkspaceRows),
    };
  });
}

async function attachMembers(db: Db, rows: ProjectWithGoals[]): Promise<ProjectWithGoals[]> {
  if (rows.length === 0) return [];

  const projectIds = rows.map((row) => row.id);
  const memberRows = await db
    .select()
    .from(projectMembers)
    .where(inArray(projectMembers.projectId, projectIds))
    .orderBy(asc(projectMembers.createdAt), asc(projectMembers.id));

  const membersByProject = new Map<string, ProjectMember[]>();
  for (const row of memberRows) {
    const members = membersByProject.get(row.projectId) ?? [];
    members.push(row);
    membersByProject.set(row.projectId, members);
  }

  return rows.map((row) => ({
    ...row,
    members: membersByProject.get(row.id) ?? [],
  }));
}

async function attachSlackChannels(db: Db, rows: ProjectWithGoals[]): Promise<ProjectWithGoals[]> {
  if (rows.length === 0) return [];

  const projectIds = rows.map((row) => row.id);
  const slackChannelRows = await db
    .select()
    .from(projectSlackChannels)
    .where(inArray(projectSlackChannels.projectId, projectIds));

  const byProjectId = new Map(
    slackChannelRows.map((row) => [row.projectId, toProjectSlackChannelSummary(row)] as const),
  );
  return rows.map((row) => ({
    ...row,
    slackChannel: byProjectId.get(row.id) ?? null,
  }));
}

async function hydrateProjects(db: Db, rows: ProjectRow[]): Promise<ProjectWithGoals[]> {
  if (rows.length === 0) return [];

  const withGoals = await attachGoals(db, rows);
  const withMembers = await attachMembers(db, withGoals);
  const withSlackChannels = await attachSlackChannels(db, withMembers);
  return attachWorkspaces(db, withSlackChannels);
}

/** Sync the project_goals join table for a single project. */
async function syncGoalLinks(db: Db, projectId: string, companyId: string, goalIds: string[]) {
  // Delete existing links
  await db.delete(projectGoals).where(eq(projectGoals.projectId, projectId));

  // Insert new links
  if (goalIds.length > 0) {
    await db.insert(projectGoals).values(
      goalIds.map((goalId) => ({ projectId, goalId, companyId })),
    );
  }
}

/** Resolve goalIds from input, handling the legacy goalId field. */
function resolveGoalIds(data: { goalIds?: string[]; goalId?: string | null }): string[] | undefined {
  if (data.goalIds !== undefined) return data.goalIds;
  if (data.goalId !== undefined) {
    return data.goalId ? [data.goalId] : [];
  }
  return undefined;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeWorkspaceCwd(value: unknown): string | null {
  const cwd = readNonEmptyString(value);
  if (!cwd) return null;
  return cwd === REPO_ONLY_CWD_SENTINEL ? null : cwd;
}

function deriveNameFromCwd(cwd: string): string {
  const normalized = cwd.replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? "Local folder";
}

function deriveNameFromRepoUrl(repoUrl: string): string {
  try {
    const url = new URL(repoUrl);
    const cleanedPath = url.pathname.replace(/\/+$/, "");
    const lastSegment = cleanedPath.split("/").filter(Boolean).pop() ?? "";
    const noGitSuffix = lastSegment.replace(/\.git$/i, "");
    return noGitSuffix || repoUrl;
  } catch {
    return repoUrl;
  }
}

function deriveWorkspaceName(input: {
  name?: string | null;
  cwd?: string | null;
  repoUrl?: string | null;
}) {
  const explicit = readNonEmptyString(input.name);
  if (explicit) return explicit;

  const cwd = readNonEmptyString(input.cwd);
  if (cwd) return deriveNameFromCwd(cwd);

  const repoUrl = readNonEmptyString(input.repoUrl);
  if (repoUrl) return deriveNameFromRepoUrl(repoUrl);

  return "Workspace";
}

async function ensureSinglePrimaryWorkspace(
  dbOrTx: any,
  input: {
    companyId: string;
    projectId: string;
    keepWorkspaceId: string;
  },
) {
  await dbOrTx
    .update(projectWorkspaces)
    .set({ isPrimary: false, updatedAt: new Date() })
    .where(
      and(
        eq(projectWorkspaces.companyId, input.companyId),
        eq(projectWorkspaces.projectId, input.projectId),
      ),
    );

  await dbOrTx
    .update(projectWorkspaces)
    .set({ isPrimary: true, updatedAt: new Date() })
    .where(
      and(
        eq(projectWorkspaces.companyId, input.companyId),
        eq(projectWorkspaces.projectId, input.projectId),
        eq(projectWorkspaces.id, input.keepWorkspaceId),
      ),
    );
}

export function projectService(db: Db) {
  async function listReferenceRows(companyId: string): Promise<ProjectReferenceRow[]> {
    return db
      .select({
        id: projects.id,
        name: projects.name,
        metadata: projects.metadata,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .where(eq(projects.companyId, companyId));
  }

  function applyProjectReferenceAliases<T extends ProjectRow>(
    row: T,
    resolvedAliases?: Map<string, ReferenceAliases>,
  ): T {
    if (!resolvedAliases) return row;
    return applyResolvedReferenceAliases(row, resolvedAliases.get(row.id));
  }

  return {
    list: async (companyId: string): Promise<ProjectWithGoals[]> => {
      const rows = await db.select().from(projects).where(eq(projects.companyId, companyId));
      const referenceRows = await listReferenceRows(companyId);
      const resolvedAliases = resolveEntityReferenceAliases("project", referenceRows);
      const hydratedRows = rows.map((row) => applyProjectReferenceAliases(row, resolvedAliases));
      return hydrateProjects(db, hydratedRows);
    },

    listByIds: async (companyId: string, ids: string[]): Promise<ProjectWithGoals[]> => {
      const dedupedIds = [...new Set(ids)];
      if (dedupedIds.length === 0) return [];
      const rows = await db
        .select()
        .from(projects)
        .where(and(eq(projects.companyId, companyId), inArray(projects.id, dedupedIds)));
      const referenceRows = await listReferenceRows(companyId);
      const resolvedAliases = resolveEntityReferenceAliases("project", referenceRows);
      const hydratedRows = rows.map((row) => applyProjectReferenceAliases(row, resolvedAliases));
      const withWorkspaces = await hydrateProjects(db, hydratedRows);
      const byId = new Map(withWorkspaces.map((project) => [project.id, project]));
      return dedupedIds.map((id) => byId.get(id)).filter((project): project is ProjectWithGoals => Boolean(project));
    },

    getById: async (id: string): Promise<ProjectWithGoals | null> => {
      const row = await db
        .select()
        .from(projects)
        .where(eq(projects.id, id))
        .then((rows) => rows[0] ?? null);
      if (!row) return null;
      const referenceRows = await listReferenceRows(row.companyId);
      const resolvedAliases = resolveEntityReferenceAliases("project", referenceRows);
      const [enriched] = await hydrateProjects(db, [applyProjectReferenceAliases(row, resolvedAliases)]);
      return enriched ?? null;
    },

    create: async (
      companyId: string,
      data: Omit<typeof projects.$inferInsert, "companyId"> & { goalIds?: string[] },
    ): Promise<ProjectWithGoals> => {
      const { goalIds: inputGoalIds, ...projectData } = data;
      const ids = resolveGoalIds({ goalIds: inputGoalIds, goalId: projectData.goalId });

      // Auto-assign a color from the palette if none provided
      if (!projectData.color) {
        const existing = await db.select({ color: projects.color }).from(projects).where(eq(projects.companyId, companyId));
        const usedColors = new Set(existing.map((r) => r.color).filter(Boolean));
        const nextColor = PROJECT_COLORS.find((c) => !usedColors.has(c)) ?? PROJECT_COLORS[existing.length % PROJECT_COLORS.length];
        projectData.color = nextColor;
      }

      // Also write goalId to the legacy column (first goal or null)
      const legacyGoalId = ids && ids.length > 0 ? ids[0] : projectData.goalId ?? null;
      const referenceRows = await listReferenceRows(companyId);
      const candidateId = "__candidate__";
      const resolvedAliases = resolveEntityReferenceAliases("project", [
        ...referenceRows,
        {
          id: candidateId,
          name: projectData.name,
          metadata: stripResolvedReferenceAliases(
            (projectData.metadata as Record<string, unknown> | null | undefined) ?? null,
          ),
          createdAt: new Date(),
        },
      ]);
      const aliasMetadata = resolvedAliases.get(candidateId);

      const row = await db
        .insert(projects)
        .values({
          ...projectData,
          metadata: aliasMetadata
            ? applyResolvedReferenceAliases(
                {
                  id: candidateId,
                  name: projectData.name,
                  metadata: (projectData.metadata as Record<string, unknown> | null | undefined) ?? null,
                },
                aliasMetadata,
              ).metadata
            : ((projectData.metadata as Record<string, unknown> | null | undefined) ?? null),
          goalId: legacyGoalId,
          companyId,
        })
        .returning()
        .then((rows) => rows[0]);

      if (ids && ids.length > 0) {
        await syncGoalLinks(db, row.id, companyId, ids);
      }

      const [enriched] = await hydrateProjects(db, [row]);
      return enriched!;
    },

    update: async (
      id: string,
      data: Partial<typeof projects.$inferInsert> & { goalIds?: string[] },
    ): Promise<ProjectWithGoals | null> => {
      const { goalIds: inputGoalIds, ...projectData } = data;
      const ids = resolveGoalIds({ goalIds: inputGoalIds, goalId: projectData.goalId });
      const existingProject =
        projectData.name !== undefined || projectData.metadata !== undefined
          ? await db
              .select()
              .from(projects)
              .where(eq(projects.id, id))
              .then((rows) => rows[0] ?? null)
          : null;
      if ((projectData.name !== undefined || projectData.metadata !== undefined) && !existingProject) {
        return null;
      }

      // Keep legacy goalId column in sync
      const updates: Partial<typeof projects.$inferInsert> = {
        ...projectData,
        updatedAt: new Date(),
      };
      if (ids !== undefined) {
        updates.goalId = ids.length > 0 ? ids[0] : null;
      }
      if (projectData.metadata !== undefined && projectData.name === undefined) {
        const existingAliases = readReferenceAliases(existingProject?.metadata ?? null);
        if (existingAliases) {
          updates.metadata = applyResolvedReferenceAliases(
            {
              id,
              name: existingProject?.name ?? "project",
              metadata: (projectData.metadata as Record<string, unknown> | null | undefined) ?? null,
            },
            existingAliases,
          ).metadata;
        }
      }
      if (projectData.name !== undefined) {
        const projectRecord = existingProject!;
        const referenceRows = await listReferenceRows(projectRecord.companyId);
        const candidateMetadataBase =
          projectData.metadata !== undefined
            ? ((projectData.metadata as Record<string, unknown> | null | undefined) ?? null)
            : stripResolvedReferenceAliases((projectRecord.metadata as Record<string, unknown> | null | undefined) ?? null);
        const resolvedAliases = resolveEntityReferenceAliases(
          "project",
          referenceRows.map((row) =>
            row.id === id
              ? {
                  ...row,
                  name: projectData.name ?? row.name,
                  metadata: stripResolvedReferenceAliases(candidateMetadataBase),
                }
              : row,
          ),
        );
        const aliasMetadata = resolvedAliases.get(id);
        if (aliasMetadata) {
          updates.metadata = applyResolvedReferenceAliases(
            {
              id,
              name: projectData.name,
              metadata: candidateMetadataBase,
            },
            aliasMetadata,
          ).metadata;
        }
      }

      const row = await db
        .update(projects)
        .set(updates)
        .where(eq(projects.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
      if (!row) return null;

      if (ids !== undefined) {
        await syncGoalLinks(db, id, row.companyId, ids);
      }

      const [enriched] = await hydrateProjects(db, [row]);
      return enriched ?? null;
    },

    remove: (id: string) =>
      db
        .delete(projects)
        .where(eq(projects.id, id))
        .returning()
        .then((rows) => {
          const row = rows[0] ?? null;
          if (!row) return null;
          return { ...row, urlKey: deriveProjectUrlKey(row.name, row.id) };
        }),

    listWorkspaces: async (projectId: string): Promise<ProjectWorkspace[]> => {
      const rows = await db
        .select()
        .from(projectWorkspaces)
        .where(eq(projectWorkspaces.projectId, projectId))
        .orderBy(desc(projectWorkspaces.isPrimary), asc(projectWorkspaces.createdAt), asc(projectWorkspaces.id));
      return rows.map(toWorkspace);
    },

    createWorkspace: async (
      projectId: string,
      data: CreateWorkspaceInput,
    ): Promise<ProjectWorkspace | null> => {
      const project = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .then((rows) => rows[0] ?? null);
      if (!project) return null;

      const cwd = normalizeWorkspaceCwd(data.cwd);
      const repoUrl = readNonEmptyString(data.repoUrl);
      if (!cwd && !repoUrl) return null;
      const name = deriveWorkspaceName({
        name: data.name,
        cwd,
        repoUrl,
      });

      const existing = await db
        .select()
        .from(projectWorkspaces)
        .where(eq(projectWorkspaces.projectId, projectId))
        .orderBy(asc(projectWorkspaces.createdAt))
        .then((rows) => rows);

      const shouldBePrimary = data.isPrimary === true || existing.length === 0;
      const created = await db.transaction(async (tx) => {
        if (shouldBePrimary) {
          await tx
            .update(projectWorkspaces)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(
              and(
                eq(projectWorkspaces.companyId, project.companyId),
                eq(projectWorkspaces.projectId, projectId),
              ),
            );
        }

        const row = await tx
          .insert(projectWorkspaces)
          .values({
            companyId: project.companyId,
            projectId,
            name,
            cwd: cwd ?? null,
            repoUrl: repoUrl ?? null,
            repoRef: readNonEmptyString(data.repoRef),
            metadata: (data.metadata as Record<string, unknown> | null | undefined) ?? null,
            isPrimary: shouldBePrimary,
          })
          .returning()
          .then((rows) => rows[0] ?? null);
        return row;
      });

      return created ? toWorkspace(created) : null;
    },

    updateWorkspace: async (
      projectId: string,
      workspaceId: string,
      data: UpdateWorkspaceInput,
    ): Promise<ProjectWorkspace | null> => {
      const existing = await db
        .select()
        .from(projectWorkspaces)
        .where(
          and(
            eq(projectWorkspaces.id, workspaceId),
            eq(projectWorkspaces.projectId, projectId),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!existing) return null;

      const nextCwd =
        data.cwd !== undefined
          ? normalizeWorkspaceCwd(data.cwd)
          : normalizeWorkspaceCwd(existing.cwd);
      const nextRepoUrl =
        data.repoUrl !== undefined
          ? readNonEmptyString(data.repoUrl)
          : readNonEmptyString(existing.repoUrl);
      if (!nextCwd && !nextRepoUrl) return null;

      const patch: Partial<typeof projectWorkspaces.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (data.name !== undefined) patch.name = deriveWorkspaceName({ name: data.name, cwd: nextCwd, repoUrl: nextRepoUrl });
      if (data.name === undefined && (data.cwd !== undefined || data.repoUrl !== undefined)) {
        patch.name = deriveWorkspaceName({ cwd: nextCwd, repoUrl: nextRepoUrl });
      }
      if (data.cwd !== undefined) patch.cwd = nextCwd ?? null;
      if (data.repoUrl !== undefined) patch.repoUrl = nextRepoUrl ?? null;
      if (data.repoRef !== undefined) patch.repoRef = readNonEmptyString(data.repoRef);
      if (data.metadata !== undefined) patch.metadata = data.metadata;

      const updated = await db.transaction(async (tx) => {
        if (data.isPrimary === true) {
          await tx
            .update(projectWorkspaces)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(
              and(
                eq(projectWorkspaces.companyId, existing.companyId),
                eq(projectWorkspaces.projectId, projectId),
              ),
            );
          patch.isPrimary = true;
        } else if (data.isPrimary === false) {
          patch.isPrimary = false;
        }

        const row = await tx
          .update(projectWorkspaces)
          .set(patch)
          .where(eq(projectWorkspaces.id, workspaceId))
          .returning()
          .then((rows) => rows[0] ?? null);
        if (!row) return null;

        if (row.isPrimary) return row;

        const hasPrimary = await tx
          .select({ id: projectWorkspaces.id })
          .from(projectWorkspaces)
          .where(
            and(
              eq(projectWorkspaces.companyId, row.companyId),
              eq(projectWorkspaces.projectId, row.projectId),
              eq(projectWorkspaces.isPrimary, true),
            ),
          )
          .then((rows) => rows[0] ?? null);

        if (!hasPrimary) {
          const nextPrimaryCandidate = await tx
            .select({ id: projectWorkspaces.id })
            .from(projectWorkspaces)
            .where(
              and(
                eq(projectWorkspaces.companyId, row.companyId),
                eq(projectWorkspaces.projectId, row.projectId),
                eq(projectWorkspaces.id, row.id),
              ),
            )
            .then((rows) => rows[0] ?? null);
          const alternateCandidate = await tx
            .select({ id: projectWorkspaces.id })
            .from(projectWorkspaces)
            .where(
              and(
                eq(projectWorkspaces.companyId, row.companyId),
                eq(projectWorkspaces.projectId, row.projectId),
              ),
            )
            .orderBy(asc(projectWorkspaces.createdAt), asc(projectWorkspaces.id))
            .then((rows) => rows.find((candidate) => candidate.id !== row.id) ?? null);

          await ensureSinglePrimaryWorkspace(tx, {
            companyId: row.companyId,
            projectId: row.projectId,
            keepWorkspaceId: alternateCandidate?.id ?? nextPrimaryCandidate?.id ?? row.id,
          });
          const refreshed = await tx
            .select()
            .from(projectWorkspaces)
            .where(eq(projectWorkspaces.id, row.id))
            .then((rows) => rows[0] ?? row);
          return refreshed;
        }

        return row;
      });

      return updated ? toWorkspace(updated) : null;
    },

    removeWorkspace: async (projectId: string, workspaceId: string): Promise<ProjectWorkspace | null> => {
      const existing = await db
        .select()
        .from(projectWorkspaces)
        .where(
          and(
            eq(projectWorkspaces.id, workspaceId),
            eq(projectWorkspaces.projectId, projectId),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!existing) return null;

      const removed = await db.transaction(async (tx) => {
        const row = await tx
          .delete(projectWorkspaces)
          .where(eq(projectWorkspaces.id, workspaceId))
          .returning()
          .then((rows) => rows[0] ?? null);
        if (!row) return null;

        if (!row.isPrimary) return row;

        const next = await tx
          .select()
          .from(projectWorkspaces)
          .where(
            and(
              eq(projectWorkspaces.companyId, row.companyId),
              eq(projectWorkspaces.projectId, row.projectId),
            ),
          )
          .orderBy(asc(projectWorkspaces.createdAt), asc(projectWorkspaces.id))
          .limit(1)
          .then((rows) => rows[0] ?? null);

        if (next) {
          await ensureSinglePrimaryWorkspace(tx, {
            companyId: row.companyId,
            projectId: row.projectId,
            keepWorkspaceId: next.id,
          });
        }

        return row;
      });

      return removed ? toWorkspace(removed) : null;
    },

    resolveByReference: async (companyId: string, reference: string) => {
      const raw = reference.trim();
      if (raw.length === 0) {
        return { project: null, ambiguous: false } as const;
      }

      if (isUuidLike(raw)) {
        const row = await db
          .select({ id: projects.id, companyId: projects.companyId, name: projects.name })
          .from(projects)
          .where(and(eq(projects.id, raw), eq(projects.companyId, companyId)))
          .then((rows) => rows[0] ?? null);
        if (!row) return { project: null, ambiguous: false } as const;
        return {
          project: { id: row.id, companyId: row.companyId, urlKey: deriveProjectUrlKey(row.name, row.id) },
          ambiguous: false,
        } as const;
      }

      const urlKey = normalizeProjectUrlKey(raw);
      if (!urlKey) {
        return { project: null, ambiguous: false } as const;
      }

      const rows = await db
        .select({ id: projects.id, companyId: projects.companyId, name: projects.name })
        .from(projects)
        .where(eq(projects.companyId, companyId));
      const matches = rows.filter((row) => deriveProjectUrlKey(row.name, row.id) === urlKey);
      if (matches.length === 1) {
        const match = matches[0]!;
        return {
          project: { id: match.id, companyId: match.companyId, urlKey: deriveProjectUrlKey(match.name, match.id) },
          ambiguous: false,
        } as const;
      }
      if (matches.length > 1) {
        return { project: null, ambiguous: true } as const;
      }
      return { project: null, ambiguous: false } as const;
    },

    listMembers: async (projectId: string): Promise<ProjectMember[]> =>
      db
        .select()
        .from(projectMembers)
        .where(eq(projectMembers.projectId, projectId))
        .orderBy(asc(projectMembers.createdAt), asc(projectMembers.id)),

    addMember: async (
      projectId: string,
      input: { agentId: string; createdByAgentId?: string | null; createdByUserId?: string | null },
    ): Promise<ProjectMember | null> => {
      const project = await db
        .select({ id: projects.id, companyId: projects.companyId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .then((rows) => rows[0] ?? null);
      if (!project) return null;

      const agent = await db
        .select({ id: agents.id, companyId: agents.companyId })
        .from(agents)
        .where(eq(agents.id, input.agentId))
        .then((rows) => rows[0] ?? null);
      if (!agent || agent.companyId !== project.companyId) return null;

      const existing = await db
        .select()
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.agentId, input.agentId)))
        .then((rows) => rows[0] ?? null);
      if (existing) return existing;

      return db
        .insert(projectMembers)
        .values({
          companyId: project.companyId,
          projectId,
          agentId: input.agentId,
          createdByAgentId: input.createdByAgentId ?? null,
          createdByUserId: input.createdByUserId ?? null,
        })
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    removeMember: async (projectId: string, agentId: string): Promise<ProjectMember | null> =>
      db
        .delete(projectMembers)
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.agentId, agentId)))
        .returning()
        .then((rows) => rows[0] ?? null),

    getSlackChannel: async (projectId: string): Promise<ProjectSlackChannelSummary | null> =>
      db
        .select()
        .from(projectSlackChannels)
        .where(eq(projectSlackChannels.projectId, projectId))
        .then((rows) => (rows[0] ? toProjectSlackChannelSummary(rows[0]) : null)),

    upsertSlackChannel: async (
      projectId: string,
      input: Partial<typeof projectSlackChannels.$inferInsert>,
    ): Promise<ProjectSlackChannelSummary | null> => {
      const project = await db
        .select({ id: projects.id, companyId: projects.companyId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .then((rows) => rows[0] ?? null);
      if (!project) return null;

      const existing = await db
        .select()
        .from(projectSlackChannels)
        .where(eq(projectSlackChannels.projectId, projectId))
        .then((rows) => rows[0] ?? null);

      if (existing) {
        return db
          .update(projectSlackChannels)
          .set({
            ...input,
            updatedAt: new Date(),
          })
          .where(eq(projectSlackChannels.id, existing.id))
          .returning()
          .then((rows) => (rows[0] ? toProjectSlackChannelSummary(rows[0]) : null));
      }

      return db
        .insert(projectSlackChannels)
        .values({
          companyId: project.companyId,
          projectId,
          visibility: input.visibility ?? "public",
          status: input.status ?? "pending",
          channelId: input.channelId ?? null,
          channelName: input.channelName ?? null,
          lastError: input.lastError ?? null,
          archivedAt: input.archivedAt ?? null,
        })
        .returning()
        .then((rows) => (rows[0] ? toProjectSlackChannelSummary(rows[0]) : null));
    },
  };
}
