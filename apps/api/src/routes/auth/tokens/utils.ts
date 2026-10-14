import type { ApiTokenView } from "contract";
import {
  isApiTokenRowId,
  type ApiTokenMetadataRow,
  type ApiTokenRowId,
} from "persistence";
import { rowIdSchema } from "../../wire-bounds";

/** One list/mint entry, metadata only; bigints stringified, dates ISO. */
export function buildTokenView(row: ApiTokenMetadataRow): ApiTokenView {
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

/** Brand a `:id` path segment; `undefined` when it isn't a positive int8. */
export function parseTokenId(
  raw: string | undefined,
): ApiTokenRowId | undefined {
  const parsed = rowIdSchema.safeParse(raw);
  if (!parsed.success) {
    return undefined;
  }
  if (!isApiTokenRowId(parsed.data)) {
    return undefined;
  }
  return parsed.data;
}
