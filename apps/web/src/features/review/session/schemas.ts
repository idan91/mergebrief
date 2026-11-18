// The session read's wire payload. A malformed payload FAILS whole rather than
// degrading item-by-item: a silently dropped draft is a comment the reviewer
// writes a second time. A vocabulary value this bundle predates is not
// malformed: a required one reads as `unknown`, an optional one drops. A draft
// or attention item whose anchor kind or side it predates has no row to sit
// on, so it is held under the anchor kind `unknown`: never placed or edited.
import {
  AttentionItemKinds,
  AttentionSubjectTypes,
  type CreateDraftCommentResponse,
  type RiskWriteResponse,
} from "contract";
import { z } from "zod/v4";
import {
  ChangeGroupCategories,
  CommentAnchorKinds,
  DiffSides,
  DispositionCarryStatuses,
  DispositionDecisions,
  DispositionEvidenceKinds,
  DraftCommentStatuses,
  ReviewOutcomes,
  type Result,
} from "types";

import { dropInvalidKeys, dropNullKeys } from "@web/utils/drop-keys";
import { buildOpenEnumSchema } from "@web/utils/open-enum";
import { UnknownValues } from "@web/utils/open-enum/types";
import { parseWithSchema } from "@web/utils/parse-with-schema";

import type {
  ReviewSessionPayload,
  SessionHeldDraftComment,
  SessionLineDraftComment,
} from "./serverState";

const lineSchema = z.int().positive();
const sideSchema = buildOpenEnumSchema(DiffSides);
/** Only a kind this bundle predates; a known kind never reads as held. */
const heldAnchorKindSchema = buildOpenEnumSchema(CommentAnchorKinds).pipe(
  z.literal(UnknownValues.UNKNOWN),
);

const draftCommentBaseShape = {
  id: z.string(),
  filePath: z.string(),
  body: z.string(),
  status: buildOpenEnumSchema(DraftCommentStatuses),
};

export const sessionLineDraftCommentSchema = z.object({
  ...draftCommentBaseShape,
  kind: z.literal(CommentAnchorKinds.LINE),
  side: sideSchema,
  /** Present only when the range genuinely crosses sides. */
  startSide: sideSchema.exactOptional(),
  startLine: lineSchema,
  endLine: lineSchema,
});

export const sessionFileDraftCommentSchema = z.object({
  ...draftCommentBaseShape,
  kind: z.literal(CommentAnchorKinds.FILE),
});

export const sessionHeldDraftCommentSchema = z.object({
  ...draftCommentBaseShape,
  kind: heldAnchorKindSchema,
});

function holdUnreadableSide(
  draft: z.output<typeof sessionLineDraftCommentSchema>,
) {
  const { side, startSide, ...fields } = draft;
  const sideUnread =
    side === UnknownValues.UNKNOWN || startSide === UnknownValues.UNKNOWN;
  if (sideUnread) {
    const { id, filePath, body, status } = fields;
    return {
      id,
      filePath,
      body,
      status,
      kind: UnknownValues.UNKNOWN,
    } satisfies SessionHeldDraftComment;
  }

  const placed: SessionLineDraftComment = { ...fields, side };
  if (startSide !== undefined) {
    placed.startSide = startSide;
  }
  return placed;
}

export const sessionDraftCommentSchema = z.union([
  sessionLineDraftCommentSchema.transform(holdUnreadableSide),
  sessionFileDraftCommentSchema,
  sessionHeldDraftCommentSchema,
]);

export const sessionEvidenceSchema = z.object({
  kind: buildOpenEnumSchema(DispositionEvidenceKinds),
  ref: z.string().nullable(),
});

export const sessionDispositionSchema = dropNullKeys(
  dropInvalidKeys(
    z.object({
      filePath: z.string(),
      attribute: z.string(),
      regionStart: lineSchema,
      regionEnd: lineSchema,
      decision: buildOpenEnumSchema(DispositionDecisions),
      reason: z.string().exactOptional(),
      evidence: sessionEvidenceSchema.exactOptional(),
      carryStatus: z.enum(DispositionCarryStatuses).exactOptional(),
    }),
    ["carryStatus"],
  ),
  ["reason", "evidence", "carryStatus"],
);

export const sessionReclassificationSchema = z.object({
  changeGroupId: z.string(),
  category: buildOpenEnumSchema(ChangeGroupCategories),
});

export const sessionCarriedFromSchema = z.object({
  sessionId: z.string(),
  headSha: z.string(),
  revisions: z.int().min(1),
  items: z.int().min(0),
});

export const sessionAttentionSubjectSchema = dropNullKeys(
  z.object({
    type: buildOpenEnumSchema(AttentionSubjectTypes),
    id: z.string().exactOptional(),
    attribute: z.string().exactOptional(),
  }),
  ["id", "attribute"],
);

export const sessionLineAttentionLocationSchema = z.object({
  kind: z.literal(CommentAnchorKinds.LINE),
  filePath: z.string(),
  startLine: lineSchema,
  endLine: lineSchema,
});

export const sessionFileAttentionLocationSchema = z.object({
  kind: z.literal(CommentAnchorKinds.FILE),
  filePath: z.string(),
});

export const sessionHeldAttentionLocationSchema = z.object({
  kind: heldAnchorKindSchema,
  filePath: z.string(),
});

export const sessionAttentionItemSchema = z.object({
  kind: buildOpenEnumSchema(AttentionItemKinds),
  subject: sessionAttentionSubjectSchema,
  location: z.union([
    sessionLineAttentionLocationSchema,
    sessionFileAttentionLocationSchema,
    sessionHeldAttentionLocationSchema,
  ]),
  /** Non-empty: an item nothing can clear is not an item. */
  clearedBy: z.array(z.string()).min(1),
});

export const reviewSessionPayloadSchema = dropNullKeys(
  z.object({
    materialized: z.boolean(),
    carriedFrom: sessionCarriedFromSchema.exactOptional(),
    attention: z.array(sessionAttentionItemSchema),
    reviewOutcome: buildOpenEnumSchema(ReviewOutcomes),
    draftComments: z.array(sessionDraftCommentSchema),
    readMarks: z.array(z.string()),
    reclassifications: z.array(sessionReclassificationSchema),
    dispositions: z.array(sessionDispositionSchema),
    submittedReviewIds: z.array(z.string()),
  }),
  ["carriedFrom"],
);

export function parseReviewSessionPayload(
  body: unknown,
): Result<ReviewSessionPayload, string> {
  return parseWithSchema(reviewSessionPayloadSchema, body);
}

/**
 * A 2xx with no id is a contract violation, but the write DID land, so the
 * caller must not revert. The unusable id keeps post-now off this draft until
 * the next read replaces it.
 */
export const createDraftResponseSchema = z
  .object({ draftId: z.string() })
  .catch({ draftId: "" }) satisfies z.ZodType<CreateDraftCommentResponse>;

export const riskWriteResponseSchema = z.object({
  count: z.int().min(0),
}) satisfies z.ZodType<RiskWriteResponse>;
