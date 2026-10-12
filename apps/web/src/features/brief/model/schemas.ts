import { LineRangeSchema } from "brief-core/types";
import { ComparisonBaselineLabels, type Result } from "types";
import { z } from "zod/v4";

import { parseWithSchema } from "@web/utils/parse-with-schema";

import type { AddressedReviewComment, ComparisonMarks } from "./types";

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
