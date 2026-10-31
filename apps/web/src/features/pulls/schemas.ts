import {
  LastReviewUnavailableReasons,
  PrStackMemberStates,
  WaitReasons,
} from "contract";
import { z } from "zod/v4";
import { GenerationFailureCodes, GenerationStatuses, PrStates } from "types";

import type { ForkPrStack } from "@web/features/brief/model";
import {
  dropInvalidKeys,
  dropNullKeys,
  isPlainRecord,
} from "@web/utils/drop-keys";
import { buildOpenEnumSchema } from "@web/utils/open-enum";
import { isRecord } from "@web/utils/typeGuards";

import type {
  AvailableLastReviewComparison,
  UnavailableLastReviewComparison,
} from "./types";

/**
 * A repo id is a NUMERIC string (bigints are stringified server-side). It is
 * interpolated into `/repos/{repoId}/...` URLs, so a loose string would become
 * an unintended route instead of a rejected response.
 */
const repoIdSchema = z.string().regex(/^\d+$/);

/**
 * The wire nests a failure's detail and a capped large run's units in
 * `errorParams`; the summary carries them flat.
 */
function liftErrorParams(value: unknown): unknown {
  if (!isPlainRecord(value)) {
    return value;
  }
  const {
    errorParams,
    errorDetail: _unliftedDetail,
    cappedUnits: _unliftedUnits,
    ...generation
  } = value;
  if (!isRecord(errorParams)) {
    return generation;
  }
  const lifted: Record<string, unknown> = { ...generation };
  const detail = errorParams["detail"];
  if (typeof detail === "string") {
    lifted["errorDetail"] = detail;
  }
  if ("needed" in errorParams) {
    lifted["cappedUnits"] = {
      needed: errorParams["needed"],
      left: errorParams["left"],
      cap: errorParams["cap"],
    };
  }
  return lifted;
}

/** A failure code or wait reason this bundle predates drops; a status it predates reads `unknown`. */
export const generationSummarySchema = z
  .preprocess(
    liftErrorParams,
    dropInvalidKeys(
      z.object({
        status: buildOpenEnumSchema(GenerationStatuses),
        phase: z.string().exactOptional(),
        attempts: z.number(),
        errorCode: z.enum(GenerationFailureCodes).exactOptional(),
        errorDetail: z.string().exactOptional(),
        cappedUnits: z
          .object({ needed: z.number(), left: z.number(), cap: z.number() })
          .readonly()
          .exactOptional(),
        updatedAt: z.string(),
        waitReason: z.enum(WaitReasons).exactOptional(),
      }),
      ["phase", "errorCode", "cappedUnits", "waitReason"],
    ),
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
  .object({ unavailable: buildOpenEnumSchema(LastReviewUnavailableReasons) })
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

export const draftPolicySummarySchema = dropNullKeys(
  z.object({
    generate: z.boolean(),
    debounceSeconds: z.number().exactOptional(),
  }),
  ["debounceSeconds"],
).readonly();

/**
 * `draft` and `viewerIsAuthor` are required: they gate author-only
 * affordances. `viewerCanResolve`, `viewerCanPush`, `appInstalled` and `behind` read false when
 * a server predates them, failing closed; present but not a boolean fails.
 */
export const prSummarySchema = dropNullKeys(
  z.object({
    repoId: repoIdSchema,
    repoSlug: z.string().exactOptional(),
    prNumber: z.number(),
    title: z.string().exactOptional(),
    state: buildOpenEnumSchema(PrStates),
    baseSha: z.string().exactOptional(),
    headSha: z.string().exactOptional(),
    briefAvailable: z.boolean(),
    headBriefStored: z.boolean().exactOptional(),
    draft: z.boolean(),
    authorLogin: z.string().exactOptional(),
    viewerIsAuthor: z.boolean(),
    viewerCanResolve: z.boolean().default(false),
    viewerCanPush: z.boolean().default(false),
    appInstalled: z.boolean().default(false),
    generation: generationSummarySchema.exactOptional(),
    updatedAt: z.string(),
    behind: z.boolean().default(false),
    comparisons: prComparisonsSchema.exactOptional(),
    draftPolicy: draftPolicySummarySchema.exactOptional(),
    revisions: z.array(revisionSummarySchema).readonly().exactOptional(),
  }),
  ["repoSlug", "title", "baseSha", "headSha", "authorLogin", "generation"],
).readonly();

export const prStackMemberSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: buildOpenEnumSchema(PrStackMemberStates).exactOptional(),
  headRef: z.string().exactOptional(),
});

export const linearPrStackSchema = z.object({
  members: z.array(prStackMemberSchema),
  index: z.number(),
  baseRef: z.string().exactOptional(),
});

/** The wire union discriminates on `members`: a chain carries them, so their presence rules a fork out. */
export const forkPrStackSchema = z
  .object({
    parent: prStackMemberSchema.optional(),
    children: z.array(prStackMemberSchema),
    baseRef: z.string().exactOptional(),
    members: z.never().exactOptional(),
  })
  .transform(({ members: _absent, ...fork }) => fork satisfies ForkPrStack);

const recordedAtSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    error: "asOf must be a date string",
  });

export const pullStackSchema = dropNullKeys(
  z.object({
    stack: z.union([linearPrStackSchema, forkPrStackSchema]).exactOptional(),
    asOf: recordedAtSchema.exactOptional(),
  }),
  ["stack"],
);
