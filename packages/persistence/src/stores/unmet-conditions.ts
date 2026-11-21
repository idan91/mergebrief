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
  type UnmetPlainCondition,
} from "types/trigger-conditions";

const MAX_STORED_NAMES = 100;
const MAX_STORED_NAME_CHARS = 255;

const sourceSchema = z.enum(Object.values(TriggerConditionSources));
const namesSchema = z
  .array(z.string().max(MAX_STORED_NAME_CHARS))
  .max(MAX_STORED_NAMES)
  .readonly();

function buildSourcedSchema<Shape extends z.core.$ZodLooseShape>(shape: Shape) {
  return z.object({ ...shape, source: sourceSchema }).readonly();
}

const plainConditionSchema = z.discriminatedUnion("kind", [
  buildSourcedSchema({
    kind: z.literal(TriggerConditionKinds.READY_FOR_REVIEW),
  }),
  buildSourcedSchema({ kind: z.literal(TriggerConditionKinds.NEVER) }),
  buildSourcedSchema({
    kind: z.literal(TriggerConditionKinds.REVIEW_REQUESTED),
  }),
  buildSourcedSchema({
    kind: z.literal(TriggerConditionKinds.SIZE),
    count: z.enum(Object.values(SizeCounts)),
    side: z.enum(Object.values(SizeBoundSides)),
    limit: z.int().nonnegative(),
    actual: z.int().nonnegative(),
  }),
  buildSourcedSchema({
    kind: z.literal(TriggerConditionKinds.LABELS),
    labels: namesSchema,
  }),
  buildSourcedSchema({
    kind: z.literal(TriggerConditionKinds.TITLE_KEYWORDS),
    keywords: namesSchema,
  }),
  buildSourcedSchema({
    kind: z.literal(TriggerConditionKinds.BASE_BRANCHES),
    base: z.string().max(MAX_STORED_NAME_CHARS),
    branches: namesSchema,
  }),
  buildSourcedSchema({
    kind: z.literal(TriggerConditionKinds.PATHS),
    paths: namesSchema,
  }),
  buildSourcedSchema({
    kind: z.literal(TriggerConditionKinds.BOTS),
    bot: z.enum(Object.values(ReviewBots)),
    verdict: z.enum(Object.values(BotVerdicts)),
    state: z.enum(Object.values(BotStates)),
    issues: z.int().nonnegative().exactOptional(),
  }),
  buildSourcedSchema({
    kind: z.literal(TriggerConditionKinds.CI),
    failed: namesSchema,
    running: namesSchema,
    missing: namesSchema,
    permissionMissing: z.boolean(),
  }),
]);

const anyGroupSchema = z
  .object({
    kind: z.literal(UnmetConditionKinds.ANY),
    conditions: z.array(plainConditionSchema).min(1).readonly(),
  })
  .readonly();

/**
 * A held head's stored `unmet_conditions` document: at least one item. Keys
 * outside an item's shape are dropped, so the stored text holds only these.
 */
export const UnmetConditionsSchema = z
  .array(z.union([plainConditionSchema, anyGroupSchema]))
  .min(1)
  .readonly();

const storedListSchema = z.array(z.unknown());
const storedAnyGroupSchema = z.object({
  kind: z.literal(UnmetConditionKinds.ANY),
  conditions: storedListSchema,
});

function truncateName(name: string): string {
  return name.slice(0, MAX_STORED_NAME_CHARS);
}

function truncateNames(names: readonly string[]): readonly string[] {
  return names.slice(0, MAX_STORED_NAMES).map(truncateName);
}

function truncatePlainCondition(
  condition: UnmetPlainCondition,
): UnmetPlainCondition {
  switch (condition.kind) {
    case TriggerConditionKinds.LABELS: {
      return { ...condition, labels: truncateNames(condition.labels) };
    }
    case TriggerConditionKinds.TITLE_KEYWORDS: {
      return { ...condition, keywords: truncateNames(condition.keywords) };
    }
    case TriggerConditionKinds.BASE_BRANCHES: {
      return {
        ...condition,
        base: truncateName(condition.base),
        branches: truncateNames(condition.branches),
      };
    }
    case TriggerConditionKinds.PATHS: {
      return { ...condition, paths: truncateNames(condition.paths) };
    }
    case TriggerConditionKinds.CI: {
      return {
        ...condition,
        failed: truncateNames(condition.failed),
        running: truncateNames(condition.running),
        missing: truncateNames(condition.missing),
      };
    }
    default: {
      return condition;
    }
  }
}

/** Cuts every name list and name to what the stored document keeps. */
export function truncateUnmetConditions(
  conditions: readonly UnmetCondition[],
): readonly UnmetCondition[] {
  return conditions.map((condition) => {
    if (condition.kind !== UnmetConditionKinds.ANY) {
      return truncatePlainCondition(condition);
    }
    const members = condition.conditions.map(truncatePlainCondition);
    return { ...condition, conditions: members };
  });
}

function listReadableConditions(
  items: readonly unknown[],
): UnmetPlainCondition[] {
  const readable: UnmetPlainCondition[] = [];
  for (const item of items) {
    const parsed = plainConditionSchema.safeParse(item);
    if (parsed.success) {
      readable.push(parsed.data);
    }
  }
  return readable;
}

function parseStoredItem(item: unknown): UnmetCondition | undefined {
  const group = storedAnyGroupSchema.safeParse(item);
  if (!group.success) {
    const plain = plainConditionSchema.safeParse(item);
    return plain.success ? plain.data : undefined;
  }

  const members = listReadableConditions(group.data.conditions);
  if (members.length === 0) {
    return undefined;
  }
  return { kind: UnmetConditionKinds.ANY, conditions: members };
}

/**
 * The stored document, read back item by item: an item this schema refuses,
 * such as a kind a newer release wrote, is dropped and the rest kept, and an
 * `any` group keeps the members it can read. `undefined` for a row with none,
 * or one with no readable item.
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
  const list = storedListSchema.safeParse(raw);
  if (!list.success) {
    return undefined;
  }

  const readable: UnmetCondition[] = [];
  for (const item of list.data) {
    const parsed = parseStoredItem(item);
    if (parsed !== undefined) {
      readable.push(parsed);
    }
  }
  return readable.length > 0 ? readable : undefined;
}
