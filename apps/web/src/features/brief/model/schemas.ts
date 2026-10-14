import { LineRangeSchema } from "brief-core/types";
import { LocalBriefKinds, type LocalBriefSummary } from "contract";
import {
  ATTRIBUTE_NAME_MAX_CHARS,
  ATTRIBUTE_NAME_PATTERN,
  CRITERIA_MAX_CHARS,
  IMPLICATION_MAX_CHARS,
  RepoConfigOutcomes,
} from "repo-config";
import { ComparisonBaselineLabels, type Result } from "types";
import { z } from "zod/v4";

import { dropNullKeys } from "@web/utils/drop-keys";
import { parseWithSchema } from "@web/utils/parse-with-schema";

import type {
  AddressedReviewComment,
  ComparisonMarks,
  FileDiffPatch,
} from "./types";
import {
  isFloorAttribute,
  SLOT_PATHS,
  type RepoConfigContext,
} from "./utils/repo-config";

const nullableIntegerSchema = z.int().nullable();

/** An absent `outdated` derives from the comment having lost its line. */
export const addressedReviewCommentSchema = dropNullKeys(
  z.object({
    id: z.string(),
    file: z.string(),
    startLine: z.int().exactOptional(),
    line: z.int().exactOptional(),
    originalStartLine: z.int().exactOptional(),
    originalLine: z.int().exactOptional(),
    author: z.string(),
    body: z.string(),
    inReplyToId: z.string().exactOptional(),
    outdated: z.boolean().exactOptional(),
  }),
  [
    "startLine",
    "line",
    "originalStartLine",
    "originalLine",
    "inReplyToId",
    "outdated",
  ],
).transform(
  ({ outdated, ...comment }) =>
    ({
      ...comment,
      outdated: outdated ?? comment.line === undefined,
    }) satisfies AddressedReviewComment,
);

export const revisionChangeFileSchema = z.object({
  file: z.string(),
  addedRanges: z.array(LineRangeSchema),
  removedRanges: z.array(LineRangeSchema),
});

export const comparisonMarksSchema = dropNullKeys(
  z.object({
    baselineSha: z.string(),
    headSha: z.string(),
    baselineLabel: z.enum(ComparisonBaselineLabels),
    baselineIndex: z.int().exactOptional(),
    files: z.array(revisionChangeFileSchema),
  }),
  ["baselineIndex"],
);

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

export const repoConfigFileOutcomeSchema = z.object({
  path: z.string(),
  blobSha: z.string().nullable(),
  outcome: z.enum(RepoConfigOutcomes),
  detail: z.string().exactOptional(),
  bytesUsed: z.number().exactOptional(),
  bytesBudget: z.number().exactOptional(),
  warning: z.string().exactOptional(),
});

/** Custom names later extend a model json_schema enum: charset and caps mirror the writer's. */
export const firedCustomAttributeSchema = z.object({
  name: z.string().max(ATTRIBUTE_NAME_MAX_CHARS).regex(ATTRIBUTE_NAME_PATTERN),
  criteria: z.string().min(1).max(CRITERIA_MAX_CHARS),
  implication: z.string().min(1).max(IMPLICATION_MAX_CHARS).exactOptional(),
  paths: z.array(z.string().min(1)).exactOptional(),
});

/** The writer forbids de-emphasizing a floor attribute; a snapshot that does is not trustworthy display input. */
export const deEmphasisRuleSchema = z.object({
  attribute: z.string().refine((attribute) => !isFloorAttribute(attribute), {
    error: "a floor attribute cannot be de-emphasized",
  }),
  paths: z.array(z.string()).exactOptional(),
});

function isCanonicalSlotOrder(
  files: readonly { readonly path: string }[],
): boolean {
  return files.every((file, index) => file.path === SLOT_PATHS[index]);
}

export const repoConfigContextSchema = z.object({
  files: z
    .array(repoConfigFileOutcomeSchema)
    .length(SLOT_PATHS.length)
    .refine(isCanonicalSlotOrder, {
      error: "expected the canonical slots in order",
    }),
  collisions: z.array(z.string()),
  policy: z
    .object({
      firedCustomAttributes: z.array(firedCustomAttributeSchema),
      deEmphasize: z.array(deEmphasisRuleSchema),
    })
    .nullable(),
});

const briefContextBodySchema = z.object({
  repoConfig: repoConfigContextSchema.nullable(),
});

/**
 * The /brief-context envelope `{ repoConfig: <snapshot|null> }`. `null`
 * (generation recorded nothing) renders as if no repo config exists.
 */
export function parseBriefContext(
  value: unknown,
): Result<RepoConfigContext | null, string> {
  const parsed = parseWithSchema(briefContextBodySchema, value);
  if (!parsed.ok) {
    return parsed;
  }
  return { ok: true, value: parsed.value.repoConfig };
}
