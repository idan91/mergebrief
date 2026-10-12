// The session read's wire payload. A malformed payload FAILS whole rather than
// degrading item-by-item: a silently dropped draft is a comment the reviewer
// writes a second time.
import { AttentionItemKinds, AttentionSubjectTypes } from "contract";
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

import { dropNullKeys } from "@web/utils/drop-keys";
import { parseWithSchema } from "@web/utils/parse-with-schema";

import type { ReviewSessionPayload } from "./serverState";

const lineSchema = z.int().positive();
const sideSchema = z.enum(DiffSides);

const draftCommentBaseShape = {
  id: z.string(),
  filePath: z.string(),
  body: z.string(),
  status: z.enum(DraftCommentStatuses),
};

export const sessionDraftCommentSchema = z.discriminatedUnion("kind", [
  z.object({
    ...draftCommentBaseShape,
    kind: z.literal(CommentAnchorKinds.LINE),
    side: sideSchema,
    /** Present only when the range genuinely crosses sides. */
    startSide: sideSchema.exactOptional(),
    startLine: lineSchema,
    endLine: lineSchema,
  }),
  z.object({
    ...draftCommentBaseShape,
    kind: z.literal(CommentAnchorKinds.FILE),
  }),
]);

export const sessionDispositionSchema = dropNullKeys(
  z.object({
    filePath: z.string(),
    attribute: z.string(),
    regionStart: lineSchema,
    regionEnd: lineSchema,
    decision: z.enum(DispositionDecisions),
    reason: z.string().exactOptional(),
    evidence: z
      .object({
        kind: z.enum(DispositionEvidenceKinds),
        ref: z.string().nullable(),
      })
      .exactOptional(),
    carryStatus: z.enum(DispositionCarryStatuses).exactOptional(),
  }),
  ["reason", "evidence", "carryStatus"],
);

export const sessionReclassificationSchema = z.object({
  changeGroupId: z.string(),
  category: z.enum(ChangeGroupCategories),
});

export const sessionCarriedFromSchema = z.object({
  sessionId: z.string(),
  headSha: z.string(),
  revisions: z.int().min(1),
  items: z.int().min(0),
});

export const sessionAttentionItemSchema = z.object({
  kind: z.enum(AttentionItemKinds),
  subject: dropNullKeys(
    z.object({
      type: z.enum(AttentionSubjectTypes),
      id: z.string().exactOptional(),
      attribute: z.string().exactOptional(),
    }),
    ["id", "attribute"],
  ),
  location: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal(CommentAnchorKinds.LINE),
      filePath: z.string(),
      startLine: lineSchema,
      endLine: lineSchema,
    }),
    z.object({
      kind: z.literal(CommentAnchorKinds.FILE),
      filePath: z.string(),
    }),
  ]),
  /** Non-empty: an item nothing can clear is not an item. */
  clearedBy: z.array(z.string()).min(1),
});

export const reviewSessionPayloadSchema = dropNullKeys(
  z.object({
    materialized: z.boolean(),
    carriedFrom: sessionCarriedFromSchema.exactOptional(),
    attention: z.array(sessionAttentionItemSchema),
    reviewOutcome: z.enum(ReviewOutcomes),
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
