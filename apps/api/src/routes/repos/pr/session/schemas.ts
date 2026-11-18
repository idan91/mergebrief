// What a session write may say on the wire: every payload and path parameter
// the write routes accept, with the bounds that keep an unbounded string or
// an out-of-range id from reaching the store.
import {
  RequestBounds,
  type AddressRiskBody,
  type CreateDraftCommentBody,
  type DismissRiskBody,
  type ReanchorDraftCommentBody,
  type ReclassifyGroupBody,
  type ReopenRiskBody,
  type SetReviewOutcomeBody,
  type UpdateDraftCommentBody,
} from "contract";
import {
  ChangeGroupCategories,
  CommentAnchorKinds,
  type DiffSide,
  DiffSides,
  type DispositionEvidence,
  DispositionEvidenceKinds,
  ReviewOutcomes,
} from "types";
import { z } from "zod/v4";
import { MAX_ID_LENGTH, MAX_INT4 } from "../../../wire-bounds";

const shaSchema = z.string().min(1);
/** The span every session request names: the same pair the read takes. */
export const spanQuerySchema = z.object({ base: shaSchema, head: shaSchema });
export type BriefSpan = z.infer<typeof spanQuerySchema>;

const coordinateSchema = z.number().int().positive().max(MAX_INT4);
const filePathSchema = z.string().min(1).max(RequestBounds.PATH_LENGTH);

/** A chunk or change-group id as the Brief spells it. */
export const briefLocalIdSchema = z.string().min(1).max(MAX_ID_LENGTH);

const sideSchema = z.union([
  z.literal(DiffSides.OLD),
  z.literal(DiffSides.NEW),
]);

/** The coordinates a draft carries; they ARE the GitHub POST payload. */
const anchorShape = {
  filePath: filePathSchema,
  side: sideSchema,
  /** GitHub `start_side`; absent defaults to `side`. */
  startSide: sideSchema.exactOptional(),
  startLine: coordinateSchema,
  endLine: coordinateSchema,
};
// Cross-side line numbers are not comparable; ordering binds same-side only.
const ORDERED_LINES = {
  check: (anchor: {
    side: DiffSide;
    startSide?: DiffSide | undefined;
    startLine: number;
    endLine: number;
  }) =>
    (anchor.startSide !== undefined && anchor.startSide !== anchor.side) ||
    anchor.startLine <= anchor.endLine,
  message: "startLine must not follow endLine",
};

/**
 * `startSide` equal to `side` is the single-side shape in disguise: stored
 * and echoed as null, so non-null means genuinely two-side everywhere.
 */
function normalizeStartSide<
  T extends {
    side: DiffSide;
    startSide?: DiffSide | undefined;
  },
>(anchor: T): Omit<T, "startSide"> & { startSide: DiffSide | null } {
  const { startSide, ...rest } = anchor;
  return {
    ...rest,
    startSide:
      startSide === undefined || startSide === anchor.side ? null : startSide,
  };
}

const fileAnchorObject = z.object({
  kind: z.literal(CommentAnchorKinds.FILE),
  filePath: filePathSchema,
});

const lineAnchorObject = z.object({
  kind: z.literal(CommentAnchorKinds.LINE).exactOptional(),
  ...anchorShape,
});

function withLineAnchorChecks<
  Schema extends z.ZodType<{
    side: DiffSide;
    startSide?: DiffSide | undefined;
    startLine: number;
    endLine: number;
  }>,
>(schema: Schema) {
  return schema
    .refine(ORDERED_LINES.check, { message: ORDERED_LINES.message })
    .transform(normalizeStartSide);
}

export const anchorSchema = z.union([
  fileAnchorObject.strict(),
  withLineAnchorChecks(lineAnchorObject),
]) satisfies z.ZodType<unknown, ReanchorDraftCommentBody>;

export const draftBodySchema = z.object({
  body: z.string().min(1).max(RequestBounds.BODY_LENGTH),
}) satisfies z.ZodType<UpdateDraftCommentBody>;

export const createDraftSchema = z.union([
  fileAnchorObject.extend({ body: draftBodySchema.shape.body }).strict(),
  withLineAnchorChecks(
    lineAnchorObject.extend({ body: draftBodySchema.shape.body }),
  ),
]) satisfies z.ZodType<unknown, CreateDraftCommentBody>;

export const categorySchema = z.object({
  category: z.enum(ChangeGroupCategories),
}) satisfies z.ZodType<ReclassifyGroupBody>;

/**
 * A risk operation names its flags by ANCHOR (file, attribute, region), the
 * same coordinates the disposition row keys on. Brief-local flag ids dangle on
 * regeneration, so they never reach the wire.
 */
const riskAnchorObject = z.object({
  filePath: filePathSchema,
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

/** Bulk is ONE call carrying an array: the operation's shape, not batching. */
function buildFlagsSchema<T extends z.ZodType>(flag: T) {
  return z.object({
    flags: z.array(flag).min(1).max(RequestBounds.FLAGS_PER_CALL),
  });
}

export const dismissSchema = buildFlagsSchema(flagSchema).extend({
  reason: z.string().min(1).max(RequestBounds.BODY_LENGTH),
}) satisfies z.ZodType<DismissRiskBody>;

const evidenceSchema = z
  .object({
    kind: z.union([
      z.literal(DispositionEvidenceKinds.LINKED_COMMENT),
      z.literal(DispositionEvidenceKinds.CHUNK_REVIEWED),
      z.literal(DispositionEvidenceKinds.MANUAL_NOTE),
    ]),
    // Evidence with nothing behind it is a claim with no target: a pointer to
    // nothing would store its own `missing-evidence` on the way in, and a
    // note that is the reviewer's own words has to have words.
    ref: z.string().min(1).max(RequestBounds.BODY_LENGTH),
  })
  // A note is the reviewer's own words; every other kind's ref is an id.
  .refine(
    (evidence) =>
      evidence.kind === DispositionEvidenceKinds.MANUAL_NOTE ||
      evidence.ref.length <= MAX_ID_LENGTH,
    { message: "a pointer ref is an id" },
  ) satisfies z.ZodType<DispositionEvidence>;

export const addressSchema = buildFlagsSchema(
  riskAnchorObject
    .extend({ evidence: evidenceSchema })
    .refine(ORDERED_REGION.check, { message: ORDERED_REGION.message }),
) satisfies z.ZodType<AddressRiskBody>;

export const reopenSchema = buildFlagsSchema(
  flagSchema,
) satisfies z.ZodType<ReopenRiskBody>;

export const outcomeSchema = z.object({
  outcome: z.union([
    z.literal(ReviewOutcomes.COMMENT),
    z.literal(ReviewOutcomes.APPROVE),
    z.literal(ReviewOutcomes.REQUEST_CHANGES),
  ]),
}) satisfies z.ZodType<SetReviewOutcomeBody>;
