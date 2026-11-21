import { z } from "zod/v4";
import {
  BotStates,
  BotVerdicts,
  ReviewBots,
  SizeBoundSides,
  SizeMeasures,
  TriggerConditionKinds,
  TriggerConditionSetters,
  UnmetConditionKinds,
  type UnmetBaseBranches,
  type UnmetCondition,
  type UnmetPlainCondition,
} from "types/trigger-conditions";
import type { Mutable } from "types/utils";

const MAX_STORED_NAMES = 100;
const MAX_STORED_NAME_CHARS = 255;

const setBySchema = z.enum(Object.values(TriggerConditionSetters));
const namesSchema = z
  .array(z.string().max(MAX_STORED_NAME_CHARS))
  .max(MAX_STORED_NAMES)
  .readonly();

function buildSetBySchema<Shape extends z.core.$ZodLooseShape>(shape: Shape) {
  return z.object({ ...shape, setBy: setBySchema }).readonly();
}

const plainConditionSchema = z.discriminatedUnion("kind", [
  buildSetBySchema({
    kind: z.literal(TriggerConditionKinds.READY_FOR_REVIEW),
  }),
  buildSetBySchema({ kind: z.literal(TriggerConditionKinds.NEVER) }),
  buildSetBySchema({
    kind: z.literal(TriggerConditionKinds.REVIEW_REQUESTED),
  }),
  buildSetBySchema({
    kind: z.literal(TriggerConditionKinds.SIZE),
    measure: z.enum(Object.values(SizeMeasures)),
    side: z.enum(Object.values(SizeBoundSides)),
    limit: z.int().nonnegative(),
    actual: z.int().nonnegative(),
  }),
  buildSetBySchema({
    kind: z.literal(TriggerConditionKinds.LABELS),
    labels: namesSchema,
  }),
  buildSetBySchema({
    kind: z.literal(TriggerConditionKinds.TITLE_KEYWORDS),
    keywords: namesSchema,
  }),
  buildSetBySchema({
    kind: z.literal(TriggerConditionKinds.BASE_BRANCHES),
    base: z.string().max(MAX_STORED_NAME_CHARS).exactOptional(),
    branches: namesSchema,
  }),
  buildSetBySchema({
    kind: z.literal(TriggerConditionKinds.PATHS),
    paths: namesSchema,
  }),
  buildSetBySchema({
    kind: z.literal(TriggerConditionKinds.BOTS),
    bot: z.enum(Object.values(ReviewBots)),
    verdict: z.enum(Object.values(BotVerdicts)),
    state: z.enum(Object.values(BotStates)),
    issues: z.int().nonnegative().exactOptional(),
  }),
  buildSetBySchema({
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

function truncateBaseBranches(condition: UnmetBaseBranches): UnmetBaseBranches {
  const truncated: Mutable<UnmetBaseBranches> = {
    ...condition,
    branches: truncateNames(condition.branches),
  };
  if (condition.base !== undefined) {
    truncated.base = truncateName(condition.base);
  }
  return truncated;
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
      return truncateBaseBranches(condition);
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

/** A stored item read back, and whether reading it dropped a group member. */
interface StoredItemRead {
  readonly kept?: UnmetCondition;
  readonly dropped: boolean;
}

/** A held head's stored conditions as this release reads them. */
export interface StoredUnmetConditions {
  /** The items it reads; empty when it reads none. */
  readonly conditions: readonly UnmetCondition[];
  /** An item or an `any` member was dropped, so the list is not the whole reason. */
  readonly partial: boolean;
}

const UNREADABLE: StoredUnmetConditions = { conditions: [], partial: true };

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

function readStoredItem(item: unknown): StoredItemRead {
  const group = storedAnyGroupSchema.safeParse(item);
  if (!group.success) {
    const plain = plainConditionSchema.safeParse(item);
    if (!plain.success) {
      return { dropped: true };
    }
    return { kept: plain.data, dropped: false };
  }

  const members = listReadableConditions(group.data.conditions);
  if (members.length === 0) {
    return { dropped: true };
  }
  const dropped = members.length < group.data.conditions.length;
  return {
    kept: { kind: UnmetConditionKinds.ANY, conditions: members },
    dropped,
  };
}

/** The kinds a check run or status can move: only they read the head's reports. */
const CHECK_REPORT_KINDS: ReadonlySet<string> = new Set([
  TriggerConditionKinds.BOTS,
  TriggerConditionKinds.CI,
]);

function isCheckReportKind(condition: UnmetPlainCondition): boolean {
  return CHECK_REPORT_KINDS.has(condition.kind);
}

/**
 * Whether a check run or status can move a held head: a `bots` or `ci` item
 * holds it, alone or in an `any` group. A document read only in part, or
 * with nothing readable, answers true: an item this build cannot read may be
 * one a report moves, so the head is checked again rather than left.
 */
export function isHeldOnCheckReports(stored: string | null): boolean {
  const parsed = parseUnmetConditions(stored);
  if (parsed === undefined || parsed.partial) {
    return true;
  }
  const { conditions } = parsed;
  if (conditions.length === 0) {
    return true;
  }
  return conditions.some((condition) => {
    if (condition.kind !== UnmetConditionKinds.ANY) {
      return isCheckReportKind(condition);
    }
    return condition.conditions.some(isCheckReportKind);
  });
}

/**
 * The stored document, read back item by item: an item this schema refuses,
 * such as a kind a newer release wrote, is dropped and the rest kept, and an
 * `any` group keeps the members it can read. Any drop marks the read partial,
 * and so does a document that is no list. `undefined` for a row with none.
 */
export function parseUnmetConditions(
  stored: string | null,
): StoredUnmetConditions | undefined {
  if (stored === null) {
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return UNREADABLE;
  }
  const list = storedListSchema.safeParse(raw);
  if (!list.success) {
    return UNREADABLE;
  }

  const conditions: UnmetCondition[] = [];
  let partial = false;
  for (const item of list.data) {
    const read = readStoredItem(item);
    if (read.kept !== undefined) {
      conditions.push(read.kept);
    }
    partial ||= read.dropped;
  }
  return { conditions, partial };
}
