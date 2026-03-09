import {
  generateUniqueReferenceAliases,
  mergeReferenceAliasesMetadata,
  readReferenceAliases,
  removeReferenceAliasesMetadata,
  type ReferenceAliases,
  type ReferenceEntityKind,
} from "@orchestorai/shared";

interface ReferenceRow {
  id: string;
  name: string;
  metadata: Record<string, unknown> | null | undefined;
  createdAt?: Date | null;
  urlKey?: string | null;
}

interface ResolveReferenceOptions<T extends ReferenceRow> {
  shouldReserve?: (row: T) => boolean;
}

function sortReferenceRows<T extends ReferenceRow>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    const leftTs = left.createdAt instanceof Date ? left.createdAt.getTime() : 0;
    const rightTs = right.createdAt instanceof Date ? right.createdAt.getTime() : 0;
    if (leftTs !== rightTs) return leftTs - rightTs;
    return left.id.localeCompare(right.id);
  });
}

export function resolveEntityReferenceAliases<T extends ReferenceRow>(
  kind: ReferenceEntityKind,
  rows: T[],
  options?: ResolveReferenceOptions<T>,
): Map<string, ReferenceAliases> {
  const sortedRows = sortReferenceRows(rows);
  const resolved = new Map<string, ReferenceAliases>();
  const takenAliases = new Set<string>();
  const rowsNeedingGeneration: T[] = [];
  const shouldReserve = options?.shouldReserve ?? (() => true);

  for (const row of sortedRows) {
    const stored = readReferenceAliases(row.metadata);
    if (!stored) {
      rowsNeedingGeneration.push(row);
      continue;
    }

    const uniqueAliases = stored.aliases.filter((alias) => !takenAliases.has(alias));
    if (uniqueAliases.length === 0) {
      rowsNeedingGeneration.push(row);
      continue;
    }

    const primaryAlias =
      uniqueAliases.find((alias) => alias === stored.primaryAlias) ?? uniqueAliases[0] ?? stored.primaryAlias;
    const entry: ReferenceAliases = {
      aliasMode: stored.aliasMode,
      primaryAlias: primaryAlias!,
      aliases: uniqueAliases,
    };
    resolved.set(row.id, entry);

    if (shouldReserve(row)) {
      for (const alias of uniqueAliases) {
        takenAliases.add(alias);
      }
    }
  }

  for (const row of rowsNeedingGeneration) {
    const generated = generateUniqueReferenceAliases({
      kind,
      name: row.name,
      urlKey: row.urlKey,
      takenAliases,
    });
    resolved.set(row.id, generated);
    if (shouldReserve(row)) {
      for (const alias of generated.aliases) {
        takenAliases.add(alias);
      }
    }
  }

  return resolved;
}

export function applyResolvedReferenceAliases<T extends ReferenceRow>(
  row: T,
  resolvedAliases: ReferenceAliases | null | undefined,
): T {
  if (!resolvedAliases) return row;
  return {
    ...row,
    metadata: mergeReferenceAliasesMetadata(row.metadata ?? null, resolvedAliases),
  };
}

export function stripResolvedReferenceAliases(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  return removeReferenceAliasesMetadata(metadata);
}
