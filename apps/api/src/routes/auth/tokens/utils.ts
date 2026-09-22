import {
  isApiTokenRowId,
  type ApiTokenMetadataRow,
  type ApiTokenRowId,
} from "persistence";

/** One list/mint entry, metadata only; bigints stringified, dates ISO. */
export function buildTokenView(
  row: ApiTokenMetadataRow,
): Record<string, string | null> {
  return {
    id: String(row.id),
    name: row.name,
    userLogin: row.userLogin,
    scope: row.scope,
    expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
    lastUsedAt: row.lastUsedAt === null ? null : row.lastUsedAt.toISOString(),
    revokedAt: row.revokedAt === null ? null : row.revokedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Brand a `:id` path segment; `undefined` when it isn't a positive int. */
export function parseTokenId(
  raw: string | undefined,
): ApiTokenRowId | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return undefined;
  }
  const value = BigInt(raw);
  return isApiTokenRowId(value) ? value : undefined;
}
