import {
  ChangeGroupCategories,
  CommentAnchorKinds,
  DiffSides,
  DispositionEvidenceKinds,
  ReviewOutcomes,
} from "types";
import { z } from "zod/v4";

const lineAnchorSchema = z.object({
  kind: z.literal(CommentAnchorKinds.LINE).exactOptional(),
  filePath: z.string().min(1),
  side: z.enum(DiffSides),
  startSide: z.enum(DiffSides).exactOptional(),
  startLine: z.int().min(1),
  endLine: z.int().min(1),
});

const fileAnchorSchema = z.object({
  kind: z.literal(CommentAnchorKinds.FILE),
  filePath: z.string().min(1),
});

export const draftAnchorSchema = z.union([fileAnchorSchema, lineAnchorSchema]);

const draftTextSchema = z.object({ body: z.string().min(1) });

export const createDraftSchema = z.intersection(
  draftAnchorSchema,
  draftTextSchema,
);

export const updateDraftSchema = draftTextSchema;

export const reclassifySchema = z.object({
  category: z.enum(ChangeGroupCategories),
});

const flagSchema = z.object({
  filePath: z.string(),
  attribute: z.string(),
  regionStart: z.int(),
  regionEnd: z.int(),
});

export const dismissRisksSchema = z.object({
  flags: z.array(flagSchema),
  reason: z.string(),
});

export const addressRisksSchema = z.object({
  flags: z.array(
    flagSchema.extend({
      evidence: z.object({
        kind: z.enum(DispositionEvidenceKinds),
        ref: z.string().min(1),
      }),
    }),
  ),
});

export const reopenRisksSchema = z.object({ flags: z.array(flagSchema) });

export const setOutcomeSchema = z.object({ outcome: z.enum(ReviewOutcomes) });
