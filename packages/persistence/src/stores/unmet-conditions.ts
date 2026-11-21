import { z } from "zod/v4";
import {
  BotStates,
  BotVerdicts,
  ReviewBots,
  SizeBoundSides,
  SizeCounts,
  TriggerConditionKinds,
  TriggerConditionSources,
  UnmetConditionKinds,
  type UnmetCondition,
} from "types/trigger-conditions";

const MAX_STORED_NAMES = 100;
const MAX_STORED_NAME_CHARS = 255;

const sourceSchema = z.enum(Object.values(TriggerConditionSources));
const namesSchema = z
  .array(z.string().max(MAX_STORED_NAME_CHARS))
  .max(MAX_STORED_NAMES)
  .readonly();

function withSource<Shape extends z.core.$ZodLooseShape>(shape: Shape) {
  return z.strictObject({ ...shape, source: sourceSchema }).readonly();
}

const plainConditionSchema = z.discriminatedUnion("kind", [
  withSource({ kind: z.literal(TriggerConditionKinds.READY_FOR_REVIEW) }),
  withSource({ kind: z.literal(TriggerConditionKinds.NEVER) }),
  withSource({ kind: z.literal(TriggerConditionKinds.REVIEW_REQUESTED) }),
  withSource({
    kind: z.literal(TriggerConditionKinds.SIZE),
    count: z.enum(Object.values(SizeCounts)),
    side: z.enum(Object.values(SizeBoundSides)),
    limit: z.int().nonnegative(),
    actual: z.int().nonnegative(),
  }),
  withSource({
    kind: z.literal(TriggerConditionKinds.LABELS),
    labels: namesSchema,
  }),
  withSource({
    kind: z.literal(TriggerConditionKinds.TITLE_KEYWORDS),
    keywords: namesSchema,
  }),
  withSource({
    kind: z.literal(TriggerConditionKinds.BASE_BRANCHES),
    base: z.string().max(MAX_STORED_NAME_CHARS),
    branches: namesSchema,
  }),
  withSource({
    kind: z.literal(TriggerConditionKinds.PATHS),
    paths: namesSchema,
  }),
  withSource({
    kind: z.literal(TriggerConditionKinds.BOTS),
    bot: z.enum(Object.values(ReviewBots)),
    verdict: z.enum(Object.values(BotVerdicts)),
    state: z.enum(Object.values(BotStates)),
    issues: z.int().nonnegative().exactOptional(),
  }),
  withSource({
    kind: z.literal(TriggerConditionKinds.CI),
    failed: namesSchema,
    running: namesSchema,
    missing: namesSchema,
    permissionMissing: z.boolean(),
  }),
]);

const anyGroupSchema = z
  .strictObject({
    kind: z.literal(UnmetConditionKinds.ANY),
    conditions: z.array(plainConditionSchema).min(1).readonly(),
  })
  .readonly();

/** A held head's stored `unmet_conditions` document: at least one item. */
export const UnmetConditionsSchema = z
  .array(z.union([plainConditionSchema, anyGroupSchema]))
  .min(1)
  .readonly();

/**
 * The stored document, read back; `undefined` for a row with none, or one
 * this schema refuses, so a reader never fails on a document a newer
 * release wrote.
 */
export function parseUnmetConditions(
  stored: string | null,
): readonly UnmetCondition[] | undefined {
  if (stored === null) {
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return undefined;
  }
  const parsed = UnmetConditionsSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
