export { execute, runClaudeLogin } from "./execute.js";
export { testEnvironment } from "./test.js";
export {
  parseClaudeStreamJson,
  describeClaudeFailure,
  isClaudeMaxTurnsResult,
  isClaudeUnknownSessionError,
} from "./parse.js";
import type { AdapterSessionCodec } from "@orchestorai/adapter-utils";
import { normalizeLegacyLocalAdapterSessionParams } from "@orchestorai/adapter-utils/server-utils";

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw: unknown) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const record = normalizeLegacyLocalAdapterSessionParams(raw as Record<string, unknown>) ?? {};
    const sessionId = readNonEmptyString(record.sessionId) ?? readNonEmptyString(record.session_id);
    if (!sessionId) return null;
    const cwd =
      readNonEmptyString(record.cwd) ??
      readNonEmptyString(record.workdir) ??
      readNonEmptyString(record.folder);
    const workspaceId = readNonEmptyString(record.workspaceId) ?? readNonEmptyString(record.workspace_id);
    const repoUrl = readNonEmptyString(record.repoUrl) ?? readNonEmptyString(record.repo_url);
    const repoRef = readNonEmptyString(record.repoRef) ?? readNonEmptyString(record.repo_ref);
    return {
      sessionId,
      ...(cwd ? { cwd } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(repoUrl ? { repoUrl } : {}),
      ...(repoRef ? { repoRef } : {}),
    };
  },
  serialize(params: Record<string, unknown> | null) {
    if (!params) return null;
    const normalizedParams = normalizeLegacyLocalAdapterSessionParams(params) ?? {};
    const sessionId =
      readNonEmptyString(normalizedParams.sessionId) ??
      readNonEmptyString(normalizedParams.session_id);
    if (!sessionId) return null;
    const cwd =
      readNonEmptyString(normalizedParams.cwd) ??
      readNonEmptyString(normalizedParams.workdir) ??
      readNonEmptyString(normalizedParams.folder);
    const workspaceId =
      readNonEmptyString(normalizedParams.workspaceId) ??
      readNonEmptyString(normalizedParams.workspace_id);
    const repoUrl =
      readNonEmptyString(normalizedParams.repoUrl) ??
      readNonEmptyString(normalizedParams.repo_url);
    const repoRef =
      readNonEmptyString(normalizedParams.repoRef) ??
      readNonEmptyString(normalizedParams.repo_ref);
    return {
      sessionId,
      ...(cwd ? { cwd } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(repoUrl ? { repoUrl } : {}),
      ...(repoRef ? { repoRef } : {}),
    };
  },
  getDisplayId(params: Record<string, unknown> | null) {
    if (!params) return null;
    return readNonEmptyString(params.sessionId) ?? readNonEmptyString(params.session_id);
  },
};
