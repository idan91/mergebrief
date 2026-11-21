import { z } from "zod/v4";
import {
  BotVerdicts,
  ReviewBots,
  TriggerConditionKinds,
  type TriggerConditionKind,
} from "types/trigger-conditions";

import { CiModes, SizeMeasures, type TriggerConditionSetting } from "./types";

export const MAX_LISTED_NAMES = 50;
const MAX_NAME_CHARS = 200;

/** YAML 1.2 reads `on`/`off` as strings, so both they and booleans are taken. */
export const onSchema = z
  .union([z.literal("on"), z.literal(true)])
  .transform((): true => true);

export const offSchema = z.union([z.literal("off"), z.literal(false)]);

function hasUniqueEntries(names: readonly string[]): boolean {
  return new Set(names).size === names.length;
}

const nameListSchema = z
  .array(z.string().trim().min(1).max(MAX_NAME_CHARS))
  .min(1)
  .max(MAX_LISTED_NAMES)
  .refine(hasUniqueEntries, { error: "an entry is listed twice" });

const sizeBoundsSchema = z
  .strictObject({
    min: z.int().nonnegative().exactOptional(),
    max: z.int().nonnegative().exactOptional(),
  })
  .refine((bounds) => bounds.min !== undefined || bounds.max !== undefined, {
    error: "set min, max or both",
  })
  .refine(
    (bounds) =>
      bounds.min === undefined ||
      bounds.max === undefined ||
      bounds.min <= bounds.max,
    { error: "min is above max" },
  );

const sizeSchema = z
  .strictObject({
    [SizeMeasures.CHANGED_LINES]: sizeBoundsSchema.exactOptional(),
    [SizeMeasures.ADDITIONS]: sizeBoundsSchema.exactOptional(),
    [SizeMeasures.DELETIONS]: sizeBoundsSchema.exactOptional(),
  })
  .refine((size) => Object.keys(size).length > 0, {
    error: "name changedLines, additions or deletions",
  });

const botsSchema = z
  .partialRecord(
    z.enum(Object.values(ReviewBots)),
    z.enum(Object.values(BotVerdicts)),
  )
  .refine((bots) => Object.keys(bots).length > 0, { error: "name a bot" })
  .refine((bots) => bots[ReviewBots.CLAUDE] !== BotVerdicts.APPROVED, {
    error: "claude never approves a pull request; use finished or clean",
  })
  .refine(
    (bots) =>
      Object.entries(bots).every(
        ([bot, verdict]) =>
          verdict !== BotVerdicts.CLEAN || bot === ReviewBots.CLAUDE,
      ),
    { error: "only claude reports clean" },
  );

const ciSchema = z.union([
  z.literal("required").transform(() => ({ mode: CiModes.REQUIRED })),
  z
    .strictObject({ checks: nameListSchema })
    .transform(({ checks }) => ({ mode: CiModes.NAMED, checks })),
]);

/** The YAML key each kind takes, in the order a block lists them. */
export const CONFIG_KEYS = {
  readyForReview: TriggerConditionKinds.READY_FOR_REVIEW,
  never: TriggerConditionKinds.NEVER,
  size: TriggerConditionKinds.SIZE,
  bots: TriggerConditionKinds.BOTS,
  reviewRequested: TriggerConditionKinds.REVIEW_REQUESTED,
  ci: TriggerConditionKinds.CI,
  paths: TriggerConditionKinds.PATHS,
  labels: TriggerConditionKinds.LABELS,
  titleKeywords: TriggerConditionKinds.TITLE_KEYWORDS,
  baseBranches: TriggerConditionKinds.BASE_BRANCHES,
} as const satisfies Record<string, TriggerConditionKind>;

export const ANY_KEY = "any";

type SettingSchemas = {
  readonly [Kind in TriggerConditionKind]: z.ZodType<TriggerConditionSetting>;
};

/** Each kind's value schema, pairing the parsed value with its kind. */
export const SETTING_SCHEMAS: SettingSchemas = {
  [TriggerConditionKinds.READY_FOR_REVIEW]: onSchema.transform((value) => ({
    kind: TriggerConditionKinds.READY_FOR_REVIEW,
    value,
  })),
  [TriggerConditionKinds.NEVER]: onSchema.transform((value) => ({
    kind: TriggerConditionKinds.NEVER,
    value,
  })),
  [TriggerConditionKinds.SIZE]: sizeSchema.transform((value) => ({
    kind: TriggerConditionKinds.SIZE,
    value,
  })),
  [TriggerConditionKinds.BOTS]: botsSchema.transform((value) => ({
    kind: TriggerConditionKinds.BOTS,
    value,
  })),
  [TriggerConditionKinds.REVIEW_REQUESTED]: onSchema.transform((value) => ({
    kind: TriggerConditionKinds.REVIEW_REQUESTED,
    value,
  })),
  [TriggerConditionKinds.CI]: ciSchema.transform((value) => ({
    kind: TriggerConditionKinds.CI,
    value,
  })),
  [TriggerConditionKinds.PATHS]: nameListSchema.transform((value) => ({
    kind: TriggerConditionKinds.PATHS,
    value,
  })),
  [TriggerConditionKinds.LABELS]: nameListSchema.transform((value) => ({
    kind: TriggerConditionKinds.LABELS,
    value,
  })),
  [TriggerConditionKinds.TITLE_KEYWORDS]: nameListSchema.transform((value) => ({
    kind: TriggerConditionKinds.TITLE_KEYWORDS,
    value,
  })),
  [TriggerConditionKinds.BASE_BRANCHES]: nameListSchema.transform((value) => ({
    kind: TriggerConditionKinds.BASE_BRANCHES,
    value,
  })),
};
