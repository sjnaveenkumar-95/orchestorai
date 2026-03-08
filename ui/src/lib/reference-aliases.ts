import { readReferenceAliases } from "@paperclipai/shared";

export function getPrimaryReferenceAlias(metadata: Record<string, unknown> | null | undefined): string {
  return readReferenceAliases(metadata)?.primaryAlias ?? "";
}

export function formatAgentReferenceAlias(metadata: Record<string, unknown> | null | undefined): string {
  const alias = getPrimaryReferenceAlias(metadata);
  return alias ? `@${alias}` : "";
}

export function formatProjectReferenceAlias(metadata: Record<string, unknown> | null | undefined): string {
  const alias = getPrimaryReferenceAlias(metadata);
  return alias ? `project: ${alias}` : "";
}
