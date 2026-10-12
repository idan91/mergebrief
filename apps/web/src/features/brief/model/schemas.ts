import { LineRangeSchema } from "brief-core/types";
import { LocalBriefKinds, type LocalBriefSummary } from "contract";
import { ComparisonBaselineLabels, type Result } from "types";
import { z } from "zod/v4";

import { parseWithSchema } from "@web/utils/parse-with-schema";

import type {
  AddressedReviewComment,
  ComparisonMarks,
  FileDiffPatch,
} from "./types";

const nullableIntegerSchema = z.int().nullable();

/** An absent `outdated` derives from the comment having lost its line. */
export const addressedReviewCommentSchema = z
  .object({
    id: z.string(),
    file: z.string(),
    startLine: nullableIntegerSchema.default(null),
    line: nullableIntegerSchema,
    originalStartLine: nullableIntegerSchema.default(null),
    originalLine: nullableIntegerSchema.default(null),
    author: z.string(),
    body: z.string(),
    inReplyToId: z.string().nullable(),
    outdated: z.boolean().nullish(),
  })
  .transform(
    ({ outdated, ...comment }) =>
      ({
        ...comment,
        outdated: outdated ?? comment.line === null,
      }) satisfies AddressedReviewComment,
  );

export const revisionChangeFileSchema = z.object({
  file: z.string(),
  addedRanges: z.array(LineRangeSchema),
  removedRanges: z.array(LineRangeSchema),
});

export const comparisonMarksSchema = z.object({
  baselineSha: z.string(),
  headSha: z.string(),
  baselineLabel: z.enum(ComparisonBaselineLabels),
  baselineIndex: nullableIntegerSchema.default(null),
  files: z.array(revisionChangeFileSchema),
});

export function parseAddressedReviewComment(
  value: unknown,
): Result<AddressedReviewComment, string> {
  return parseWithSchema(addressedReviewCommentSchema, value);
}

export function parseAddressedReviewComments(
  value: unknown,
): Result<AddressedReviewComment[], string> {
  return parseWithSchema(z.array(addressedReviewCommentSchema), value);
}

/** A `.comparison.json` marks sidecar: header fields plus per-file changed-line ranges. */
export function parseComparisonMarks(
  value: unknown,
): Result<ComparisonMarks, string> {
  return parseWithSchema(comparisonMarksSchema, value);
}

export const fileDiffPatchSchema = z.object({
  file: z.string(),
  patch: z.string(),
});

export const localPreviousBriefAvailabilitySchema = z
  .object({
    marksId: z.string(),
    narrativeId: z.string().exactOptional(),
    baselineSha: z.string(),
    baselineIndex: z.int(),
  })
  .readonly();

export const localLastReviewAvailabilitySchema = z
  .object({
    marksId: z.string(),
    deltaId: z.string().exactOptional(),
    baselineSha: z.string(),
    baselineIndex: nullableIntegerSchema,
  })
  .readonly();

export const localComparisonAvailabilitySchema = z
  .object({
    previousBrief: localPreviousBriefAvailabilitySchema.exactOptional(),
    lastReview: localLastReviewAvailabilitySchema.exactOptional(),
  })
  .readonly();

export const localBriefSummarySchema = z
  .object({
    id: z.string(),
    artifactKind: z.enum(LocalBriefKinds),
    repo: z.string(),
    number: z.int(),
    title: z.string(),
    sha: z.string(),
    index: z.int().exactOptional(),
    baselineSha: z.string().exactOptional(),
    headSha: z.string().exactOptional(),
    baselineIndex: nullableIntegerSchema.exactOptional(),
    headIndex: nullableIntegerSchema.exactOptional(),
    comparisons: localComparisonAvailabilitySchema.exactOptional(),
  })
  .readonly();

/** The diffs sidecar as per-file patches; the rows are sliced client-side. */
export function parseFileDiffPatches(
  value: unknown,
): Result<FileDiffPatch[], string> {
  return parseWithSchema(z.array(fileDiffPatchSchema), value);
}

/** `GET /api/local-briefs`: the dev file surface's listing rows. */
export function parseLocalBriefSummaries(
  value: unknown,
): Result<LocalBriefSummary[], string> {
  return parseWithSchema(z.array(localBriefSummarySchema), value);
}
