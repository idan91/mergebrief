// What a session write may say on the wire: every payload and path parameter
// the write routes accept, with the bounds that keep an unbounded string or
// an out-of-range id from reaching the store.
import { ChangeGroupCategory, DraftCommentSide } from "persistence";
import { z } from "zod";

const MAX_BODY_LENGTH = 65_536;
const MAX_PATH_LENGTH = 1_024;
/** Brief-local ids (chunk, change group) are short opaque tokens. */
const MAX_ID_LENGTH = 256;
/** A bigint row id on the wire: digits, and inside `int8` — past it Postgres
 * raises rather than returning no rows. */
const MAX_ROW_ID = 9_223_372_036_854_775_807n;

export const rowIdSchema = z
  .string()
  .regex(/^[0-9]{1,19}$/, "id must be a row id")
  .transform((value) => BigInt(value))
  .refine((value) => value <= MAX_ROW_ID, { message: "id out of range" });

/** A chunk or change-group id as the Brief spells it. */
export const briefLocalIdSchema = z.string().min(1).max(MAX_ID_LENGTH);

const sideSchema = z.union([
  z.literal(DraftCommentSide.OLD),
  z.literal(DraftCommentSide.NEW),
]);

/** The coordinates a draft carries; they ARE the GitHub POST payload. */
const anchorShape = {
  filePath: z.string().min(1).max(MAX_PATH_LENGTH),
  side: sideSchema,
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
};
const ORDERED_LINES = {
  check: (anchor: { startLine: number; endLine: number }) =>
    anchor.startLine <= anchor.endLine,
  message: "startLine must not follow endLine",
};

export const anchorSchema = z
  .object(anchorShape)
  .refine(ORDERED_LINES.check, { message: ORDERED_LINES.message });

export const draftBodySchema = z.object({
  body: z.string().min(1).max(MAX_BODY_LENGTH),
});

export const createDraftSchema = z
  .object({ ...anchorShape, body: z.string().min(1).max(MAX_BODY_LENGTH) })
  .refine(ORDERED_LINES.check, { message: ORDERED_LINES.message });

export const readSchema = z.object({ read: z.boolean() });

function isChangeGroupCategory(value: unknown): value is ChangeGroupCategory {
  return Object.values(ChangeGroupCategory).some((known) => known === value);
}

export const categorySchema = z.object({
  category: z.unknown().refine(isChangeGroupCategory),
});
