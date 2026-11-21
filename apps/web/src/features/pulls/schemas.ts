import {
  isAttachmentAssetId,
  LastReviewUnavailableReasons,
  PrStackMemberStates,
  WaitReasons,
  type AttachmentAssetId,
} from "contract";
import { ChunkLayoutBodySchema } from "brief-core/artifact";
import { z } from "zod/v4";
import { GenerationFailureCodes, GenerationStatuses, PrStates } from "types";
import {
  BotStates,
  BotVerdicts,
  ReviewBots,
  SizeBoundSides,
  SizeCounts,
  TriggerConditionKinds,
  TriggerConditionSources,
  UnmetConditionKinds,
} from "types/trigger-conditions";

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
  AvailablePreviousBriefComparison,
  UnavailableLastReviewComparison,
  UnavailablePreviousBriefComparison,
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

const triggerConditionSourceSchema = z.enum(TriggerConditionSources);
const configuredNamesSchema = z.array(z.string()).readonly();

/** One unmet condition; a kind, bot, state or count this bundle predates fails the item. */
const unmetPlainConditionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal(TriggerConditionKinds.READY_FOR_REVIEW),
      source: triggerConditionSourceSchema,
    })
    .readonly(),
  z
    .object({
      kind: z.literal(TriggerConditionKinds.NEVER),
      source: triggerConditionSourceSchema,
    })
    .readonly(),
  z
    .object({
      kind: z.literal(TriggerConditionKinds.REVIEW_REQUESTED),
      source: triggerConditionSourceSchema,
    })
    .readonly(),
  z
    .object({
      kind: z.literal(TriggerConditionKinds.SIZE),
      source: triggerConditionSourceSchema,
      count: z.enum(SizeCounts),
      side: z.enum(SizeBoundSides),
      limit: z.number(),
      actual: z.number(),
    })
    .readonly(),
  z
    .object({
      kind: z.literal(TriggerConditionKinds.LABELS),
      source: triggerConditionSourceSchema,
      labels: configuredNamesSchema,
    })
    .readonly(),
  z
    .object({
      kind: z.literal(TriggerConditionKinds.TITLE_KEYWORDS),
      source: triggerConditionSourceSchema,
      keywords: configuredNamesSchema,
    })
    .readonly(),
  z
    .object({
      kind: z.literal(TriggerConditionKinds.BASE_BRANCHES),
      source: triggerConditionSourceSchema,
      base: z.string(),
      branches: configuredNamesSchema,
    })
    .readonly(),
  z
    .object({
      kind: z.literal(TriggerConditionKinds.PATHS),
      source: triggerConditionSourceSchema,
      paths: configuredNamesSchema,
    })
    .readonly(),
  z
    .object({
      kind: z.literal(TriggerConditionKinds.BOTS),
      source: triggerConditionSourceSchema,
      bot: z.enum(ReviewBots),
      verdict: buildOpenEnumSchema(BotVerdicts),
      state: z.enum(BotStates),
      issues: z.number().exactOptional(),
    })
    .readonly(),
  z
    .object({
      kind: z.literal(TriggerConditionKinds.CI),
      source: triggerConditionSourceSchema,
      failed: configuredNamesSchema,
      running: configuredNamesSchema,
      missing: configuredNamesSchema,
      permissionMissing: z.boolean(),
    })
    .readonly(),
]);

const unmetAnyGroupSchema = z
  .object({
    kind: z.literal(UnmetConditionKinds.ANY),
    conditions: z.array(unmetPlainConditionSchema).min(1).readonly(),
  })
  .readonly();

export const unmetConditionSchema = z.union([
  unmetPlainConditionSchema,
  unmetAnyGroupSchema,
]);

const unmetAnyGroupWireSchema = z.object({
  kind: z.literal(UnmetConditionKinds.ANY),
  conditions: z.array(z.unknown()),
});

function isReadableCondition(entry: unknown): boolean {
  return z.safeParse(unmetPlainConditionSchema, entry).success;
}

/** One wire item as this bundle keeps it, and whether reading it left anything out. */
function keepReadableCondition(entry: unknown) {
  if (isReadableCondition(entry)) {
    return { kept: entry, dropped: false };
  }
  const group = z.safeParse(unmetAnyGroupWireSchema, entry);
  if (!group.success) {
    return { kept: undefined, dropped: true };
  }

  const members = group.data.conditions.filter(isReadableCondition);
  const dropped = members.length < group.data.conditions.length;
  if (members.length === 0) {
    return { kept: undefined, dropped: true };
  }
  return { kept: { ...group.data, conditions: members }, dropped };
}

/**
 * Keeps the held items this bundle reads, an `any` group with the members it
 * reads, and marks the list partial when anything was left out, so a reader
 * never takes part of the reason for all of it. A value that is no list drops.
 */
function keepReadableUnmetConditions(value: unknown): unknown {
  if (!isPlainRecord(value)) {
    return value;
  }
  const {
    unmetConditions,
    unmetConditionsPartial: _readerOnly,
    ...generation
  } = value;
  if (!Array.isArray(unmetConditions)) {
    return generation;
  }

  const reads = unmetConditions.map(keepReadableCondition);
  const filtered: Record<string, unknown> = {
    ...generation,
    unmetConditions: reads.flatMap(({ kept }) =>
      kept === undefined ? [] : [kept],
    ),
  };
  if (reads.some(({ dropped }) => dropped)) {
    filtered["unmetConditionsPartial"] = true;
  }
  return filtered;
}

function readGenerationWire(value: unknown): unknown {
  return keepReadableUnmetConditions(liftErrorParams(value));
}

/**
 * A failure code or wait reason this bundle predates drops; a status it
 * predates reads `unknown`; an unmet item it predates drops and marks the list partial.
 */
export const generationSummarySchema = z
  .preprocess(
    readGenerationWire,
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
        startedAt: z.string().exactOptional(),
        parts: z
          .object({ done: z.number(), total: z.number() })
          .readonly()
          .exactOptional(),
        unmetConditions: z
          .array(unmetConditionSchema)
          .readonly()
          .exactOptional(),
        unmetConditionsPartial: z.literal(true).exactOptional(),
      }),
      [
        "phase",
        "errorCode",
        "cappedUnits",
        "waitReason",
        "startedAt",
        "parts",
        "unmetConditions",
      ],
    ),
  )
  .readonly();

export const unavailablePreviousBriefSchema = z
  .object({
    baselineSha: z.string(),
    baselineIndex: z.number(),
    unavailable: buildOpenEnumSchema(LastReviewUnavailableReasons),
    narrativeAvailable: z.never().exactOptional(),
  })
  .transform(
    ({ unavailable, baselineSha, baselineIndex }) =>
      ({
        kind: "unavailable",
        baselineSha,
        baselineIndex,
        reason: unavailable,
      }) satisfies UnavailablePreviousBriefComparison,
  );

/** The wire union discriminates on the `unavailable` key, as `lastReview` does. */
export const availablePreviousBriefSchema = z
  .object({
    baselineSha: z.string(),
    baselineIndex: z.number(),
    narrativeAvailable: z.boolean(),
    unchanged: z.literal(true).exactOptional(),
    unavailable: z.never().exactOptional(),
  })
  .transform(
    ({ unavailable: _absent, ...available }) =>
      ({
        kind: "available",
        ...available,
      }) satisfies AvailablePreviousBriefComparison,
  );

export const previousBriefComparisonSchema = z
  .union([unavailablePreviousBriefSchema, availablePreviousBriefSchema])
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
    deltaSkipped: z.literal(true).exactOptional(),
    deltaUnchanged: z.literal(true).exactOptional(),
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

/** `read-brief-layout`: the stored counts; the wire's null for a brief stored without them drops. */
export const briefLayoutReplySchema = dropNullKeys(
  z.object({ layout: ChunkLayoutBodySchema.exactOptional() }),
  ["layout"],
);

const attachmentAssetIdSchema = z.custom<AttachmentAssetId>(
  (value) => typeof value === "string" && isAttachmentAssetId(value),
);

/** `list-video-assets`: the pasted assets GitHub rendered as a video. */
export const videoAssetsSchema = z
  .object({ assetIds: z.array(attachmentAssetIdSchema).readonly() })
  .readonly();
