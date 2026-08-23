// The wire bounds every PR route enforces at the boundary, defined once:
// past any of these, Postgres or GitHub fails mid-operation instead of the
// route refusing up front.
import { z } from "zod";

/** Same cap GitHub enforces on comment and review bodies. */
export const MAX_BODY_LENGTH = 65_536;
export const MAX_PATH_LENGTH = 1_024;
/** Brief-local ids (chunk, change group) are short opaque tokens. */
export const MAX_ID_LENGTH = 256;
/** A line or region coordinate on the wire: inside `int4`, past which Postgres
 * raises inside the transaction rather than refusing at the boundary. */
export const MAX_INT4 = 2_147_483_647;
/** A bigint row id on the wire: digits, and inside `int8` — past it Postgres
 * raises rather than returning no rows. */
export const MAX_ROW_ID = 9_223_372_036_854_775_807n;

export const rowIdSchema = z
  .string()
  .regex(/^[0-9]{1,19}$/, "id must be a row id")
  .transform((value) => BigInt(value))
  .refine((value) => value <= MAX_ROW_ID, { message: "id out of range" });

export const commitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "the brief's head must be a 40-hex SHA");

export const prNumberSchema = z.coerce.number().int().positive();
