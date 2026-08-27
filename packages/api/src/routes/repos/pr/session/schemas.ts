// What a session write may say on the wire: every payload and path parameter
// the write routes accept, with the bounds that keep an unbounded string or
// an out-of-range id from reaching the store.
import {
  ChangeGroupCategory,
  DispositionEvidenceKind,
  DraftCommentSide,
  ReviewOutcome,
  type DispositionEvidence,
} from "persistence";
import { z } from "zod";
import {
  MAX_BODY_LENGTH,
  MAX_ID_LENGTH,
  MAX_INT4,
  MAX_PATH_LENGTH,
} from "../wire-bounds";

const shaSchema = z.string().min(1);
/** The span every session request names — the same pair the read takes. */
export const spanQuerySchema = z.object({ base: shaSchema, head: shaSchema });
export type BriefSpan = z.infer<typeof spanQuerySchema>;

const coordinateSchema = z.number().int().positive().max(MAX_INT4);

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
  /** GitHub `start_side`; absent defaults to `side`. */
  startSide: sideSchema.optional(),
  startLine: coordinateSchema,
  endLine: coordinateSchema,
};
// Cross-side line numbers are not comparable; ordering binds same-side only.
const ORDERED_LINES = {
  check: (anchor: {
    side: DraftCommentSide;
    startSide?: DraftCommentSide | undefined;
    startLine: number;
    endLine: number;
  }) =>
    (anchor.startSide !== undefined && anchor.startSide !== anchor.side) ||
    anchor.startLine <= anchor.endLine,
  message: "startLine must not follow endLine",
};

/**
 * `startSide` equal to `side` is the single-side shape in disguise — stored
 * and echoed as null, so non-null means genuinely two-side everywhere.
 */
function normalizeStartSide<
  T extends {
    side: DraftCommentSide;
    startSide?: DraftCommentSide | undefined;
  },
>(anchor: T): Omit<T, "startSide"> & { startSide: DraftCommentSide | null } {
  const { startSide, ...rest } = anchor;
  return {
    ...rest,
    startSide:
      startSide === undefined || startSide === anchor.side ? null : startSide,
  };
}

export const anchorSchema = z
  .object(anchorShape)
  .refine(ORDERED_LINES.check, { message: ORDERED_LINES.message })
  .transform(normalizeStartSide);

export const draftBodySchema = z.object({
  body: z.string().min(1).max(MAX_BODY_LENGTH),
});

export const createDraftSchema = z
  .object({ ...anchorShape, body: z.string().min(1).max(MAX_BODY_LENGTH) })
  .refine(ORDERED_LINES.check, { message: ORDERED_LINES.message })
  .transform(normalizeStartSide);

export const readSchema = z.object({ read: z.boolean() });

function isChangeGroupCategory(value: unknown): value is ChangeGroupCategory {
  return Object.values(ChangeGroupCategory).some((known) => known === value);
}

export const categorySchema = z.object({
  category: z.unknown().refine(isChangeGroupCategory),
});

/**
 * A risk operation names its flags by ANCHOR — file, attribute, region — the
 * same coordinates the disposition row keys on. Brief-local flag ids dangle on
 * regeneration, so they never reach the wire.
 */
const riskAnchorObject = z.object({
  filePath: z.string().min(1).max(MAX_PATH_LENGTH),
  attribute: z.string().min(1).max(MAX_ID_LENGTH),
  regionStart: coordinateSchema,
  regionEnd: coordinateSchema,
});
const ORDERED_REGION = {
  check: (flag: { regionStart: number; regionEnd: number }) =>
    flag.regionStart <= flag.regionEnd,
  message: "regionStart must not follow regionEnd",
};
const flagSchema = riskAnchorObject.refine(ORDERED_REGION.check, {
  message: ORDERED_REGION.message,
});

/** Bulk is ONE call carrying an array — the operation's shape, not batching. */
const MAX_FLAGS_PER_CALL = 200;
function buildFlagsSchema<T extends z.ZodTypeAny>(flag: T) {
  return z.object({ flags: z.array(flag).min(1).max(MAX_FLAGS_PER_CALL) });
}

export const dismissSchema = buildFlagsSchema(flagSchema).extend({
  reason: z.string().min(1).max(MAX_BODY_LENGTH),
});

const evidenceSchema = z
  .object({
    kind: z.union([
      z.literal(DispositionEvidenceKind.LINKED_COMMENT),
      z.literal(DispositionEvidenceKind.CHUNK_REVIEWED),
      z.literal(DispositionEvidenceKind.MANUAL_NOTE),
    ]),
    ref: z.string().max(MAX_BODY_LENGTH).nullish(),
  })
  // Evidence with nothing behind it is a claim with no target: a pointer to
  // nothing would store its own `missing-evidence` on the way in, and a note
  // that is the reviewer's own words has to have words.
  .refine((evidence) => (evidence.ref ?? "") !== "", {
    message: "evidence needs a ref",
  })
  // A note is the reviewer's own words; every other kind's ref is an id.
  .refine(
    (evidence) =>
      evidence.kind === DispositionEvidenceKind.MANUAL_NOTE ||
      (evidence.ref ?? "").length <= MAX_ID_LENGTH,
    { message: "a pointer ref is an id" },
  )
  .transform(
    (evidence): DispositionEvidence => ({
      kind: evidence.kind,
      ref: evidence.ref ?? null,
    }),
  );

export const addressSchema = buildFlagsSchema(
  riskAnchorObject
    .extend({ evidence: evidenceSchema })
    .refine(ORDERED_REGION.check, { message: ORDERED_REGION.message }),
);

export const reopenSchema = buildFlagsSchema(flagSchema);

export const outcomeSchema = z.object({
  outcome: z.union([
    z.literal(ReviewOutcome.COMMENT),
    z.literal(ReviewOutcome.APPROVE),
    z.literal(ReviewOutcome.REQUEST_CHANGES),
  ]),
});
