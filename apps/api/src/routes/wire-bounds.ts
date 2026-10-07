// The wire bounds the routes enforce at the boundary, defined once: past
// any of these, Postgres or GitHub fails mid-operation instead of the route
// refusing up front. The Inbox page size lives here too, a server fact the
// client never sends.
import { InboxQueryBounds } from "contract";
import { isRepoId, type RepoId } from "persistence";
import type { Result } from "types/utils";
import { z } from "zod/v4";

/** Same cap GitHub enforces on comment and review bodies. */
export const MAX_BODY_LENGTH = 65_536;
export const MAX_PATH_LENGTH = 1_024;
/** Brief-local ids (chunk, change group) are short opaque tokens. */
export const MAX_ID_LENGTH = 256;
/** A line or region coordinate on the wire: inside `int4`, past which Postgres
 * raises inside the transaction rather than refusing at the boundary. */
export const MAX_INT4 = 2_147_483_647;
/** A bigint row id on the wire: digits, and inside `int8`; past it Postgres
 * raises rather than returning no rows. */
export const MAX_ROW_ID = 9_223_372_036_854_775_807n;

export const rowIdSchema = z
  .string()
  .regex(/^[0-9]{1,19}$/, { message: "id must be a row id", abort: true })
  .transform((value) => BigInt(value))
  .refine((value) => value <= MAX_ROW_ID, { message: "id out of range" });

export const commitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "the brief's head must be a 40-hex SHA");

export const prNumberSchema = z.coerce.number().int().positive().max(MAX_INT4);

/** Brand a `:repoId` path segment; a malformed or oversized id is `undefined`. */
export function parseRepoIdParam(raw: string | undefined): RepoId | undefined {
  if (raw === undefined || !/^[0-9]{1,19}$/.test(raw)) {
    return undefined;
  }
  const value = BigInt(raw);
  if (value > MAX_ROW_ID || !isRepoId(value)) {
    return undefined;
  }
  return value;
}

const MALFORMED_PR_NUMBER = "malformed-pr-number";
export type PrNumberParamResult = Result<number, typeof MALFORMED_PR_NUMBER>;

/** A `:prNumber` path segment; a malformed or oversized number is refused. */
export function parsePrNumberParam(
  raw: string | undefined,
): PrNumberParamResult {
  const parsed = prNumberSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: MALFORMED_PR_NUMBER };
  }
  return { ok: true, value: parsed.data };
}

/** Rows per Inbox page; the client asks for a page number, never a size. */
export const INBOX_PAGE_SIZE = InboxQueryBounds.PAGE_SIZE;
export const MAX_INBOX_FILTER_VALUES = InboxQueryBounds.MAX_FILTER_VALUES;
/** The contract's number is the `int4` offset ceiling; this holds it to that. */
export const MAX_INBOX_PAGE: number = Math.min(
  InboxQueryBounds.MAX_PAGE,
  Math.floor(MAX_INT4 / INBOX_PAGE_SIZE),
);
