import { LastReviewUnavailableReasons, WaitReasons } from "contract";
import { z } from "zod/v4";
import type { Result } from "types/utils";

import { dropInvalidKeys, dropNullKeys } from "@web/utils/drop-keys";
import { parseWithSchema } from "@web/utils/parse-with-schema";

import {
  GenerationFailureCodes,
  GenerationStatuses,
  PrStates,
  type AvailableLastReviewComparison,
  type GenerationSummary,
  type PrSummary,
  type UnavailableLastReviewComparison,
} from "./types";

/**
 * A repo id is a NUMERIC string (bigints are stringified server-side). It is
 * interpolated into `/repos/{repoId}/...` URLs, so a loose string would become
 * an unintended route instead of a rejected response.
 */
const repoIdSchema = z.string().regex(/^\d+$/);

function readErrorDetail(
  params: Readonly<Record<string, unknown>> | null | undefined,
): string | null {
  const detail = params?.["detail"];
  if (typeof detail === "string") {
    return detail;
  }
  return null;
}

/** An unknown failure code or wait reason degrades to the generic line: the server may ship one this bundle predates. */
export const generationSummarySchema = dropInvalidKeys(
  z.object({
    status: z.enum(GenerationStatuses),
    phase: z.string().nullable(),
    attempts: z.number(),
    errorCode: z.enum(GenerationFailureCodes).nullable().catch(null),
    errorParams: z.record(z.string(), z.unknown()).nullable().exactOptional(),
    updatedAt: z.string(),
    waitReason: z.enum(WaitReasons).exactOptional(),
  }),
  ["waitReason"],
)
  .transform(
    ({ errorParams, ...generation }) =>
      ({
        ...generation,
        errorDetail: readErrorDetail(errorParams),
      }) satisfies GenerationSummary,
  )
  .readonly();

export const previousBriefComparisonSchema = z
  .object({
    baselineSha: z.string(),
    baselineIndex: z.number(),
    narrativeAvailable: z.boolean(),
  })
  .readonly();

export const unavailableLastReviewSchema = z
  .object({ unavailable: z.enum(LastReviewUnavailableReasons) })
  .transform(
    ({ unavailable }) =>
      ({
        kind: "unavailable",
        reason: unavailable,
      }) satisfies UnavailableLastReviewComparison,
  );

/** The wire union discriminates on the `unavailable` key: its presence rules this arm out. */
export const availableLastReviewSchema = z
  .object({
    deltaAvailable: z.boolean(),
    baselineSha: z.string(),
    baselineIndex: z.number().exactOptional(),
    unavailable: z.never().exactOptional(),
  })
  .transform(
    ({ unavailable: _absent, ...available }) =>
      ({
        kind: "available",
        ...available,
      }) satisfies AvailableLastReviewComparison,
  );

export const lastReviewComparisonSchema = z
  .union([unavailableLastReviewSchema, availableLastReviewSchema])
  .readonly();

export const prComparisonsSchema = z
  .object({
    previousBrief: previousBriefComparisonSchema.exactOptional(),
    lastReview: lastReviewComparisonSchema.exactOptional(),
  })
  .readonly();

/** A revision's `comparisons` is the same envelope as the top-level one, empty when absent. */
export const revisionSummarySchema = z
  .object({
    headSha: z.string(),
    baseSha: z.string(),
    headIndex: z.number(),
    createdAt: z.string(),
    generatedAt: z.string().exactOptional(),
    comparisons: prComparisonsSchema.default({}),
  })
  .readonly();

export const draftPolicySummarySchema = z
  .object({ generate: z.boolean(), debounceSeconds: z.number().nullable() })
  .readonly();

/**
 * `draft` and `viewerIsAuthor` are required: they gate author-only
 * affordances. `viewerCanResolve`, `appInstalled` and `behind` read false when
 * a server predates them, failing closed; present but not a boolean fails.
 */
export const prSummarySchema = dropNullKeys(
  z.object({
    repoId: repoIdSchema,
    repoSlug: z.string().nullable(),
    prNumber: z.number(),
    title: z.string().nullable(),
    state: z.enum(PrStates),
    baseSha: z.string().nullable(),
    headSha: z.string().nullable(),
    briefAvailable: z.boolean(),
    draft: z.boolean(),
    authorLogin: z.string().exactOptional(),
    viewerIsAuthor: z.boolean(),
    viewerCanResolve: z.boolean().default(false),
    appInstalled: z.boolean().default(false),
    generation: generationSummarySchema.nullable(),
    updatedAt: z.string(),
    behind: z.boolean().default(false),
    comparisons: prComparisonsSchema.exactOptional(),
    draftPolicy: draftPolicySummarySchema.exactOptional(),
    revisions: z.array(revisionSummarySchema).readonly().exactOptional(),
  }),
  ["authorLogin"],
).readonly();

export function parsePrSummary(value: unknown): Result<PrSummary, string> {
  return parseWithSchema(prSummarySchema, value);
}
