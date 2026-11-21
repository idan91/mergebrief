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
import { isRecord } from "../../utils";

const sourceSchema = z.enum(TriggerConditionSources);
const namesSchema = z.array(z.string());

const plainConditionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal(TriggerConditionKinds.READY_FOR_REVIEW),
    source: sourceSchema,
  }),
  z.object({
    kind: z.literal(TriggerConditionKinds.NEVER),
    source: sourceSchema,
  }),
  z.object({
    kind: z.literal(TriggerConditionKinds.REVIEW_REQUESTED),
    source: sourceSchema,
  }),
  z.object({
    kind: z.literal(TriggerConditionKinds.SIZE),
    source: sourceSchema,
    count: z.enum(SizeCounts),
    side: z.enum(SizeBoundSides),
    limit: z.number(),
    actual: z.number(),
  }),
  z.object({
    kind: z.literal(TriggerConditionKinds.LABELS),
    source: sourceSchema,
    labels: namesSchema,
  }),
  z.object({
    kind: z.literal(TriggerConditionKinds.TITLE_KEYWORDS),
    source: sourceSchema,
    keywords: namesSchema,
  }),
  z.object({
    kind: z.literal(TriggerConditionKinds.BASE_BRANCHES),
    source: sourceSchema,
    base: z.string(),
    branches: namesSchema,
  }),
  z.object({
    kind: z.literal(TriggerConditionKinds.PATHS),
    source: sourceSchema,
    paths: namesSchema,
  }),
  z.object({
    kind: z.literal(TriggerConditionKinds.BOTS),
    source: sourceSchema,
    bot: z.enum(ReviewBots),
    verdict: z.enum(BotVerdicts),
    state: z.enum(BotStates),
    issues: z.number().exactOptional(),
  }),
  z.object({
    kind: z.literal(TriggerConditionKinds.CI),
    source: sourceSchema,
    failed: namesSchema,
    running: namesSchema,
    missing: namesSchema,
    permissionMissing: z.boolean(),
  }),
]);

const anyGroupSchema = z.object({
  kind: z.literal(UnmetConditionKinds.ANY),
  conditions: z.array(z.unknown()),
});

/** One unmet item as this build reads it: a condition it knows, or the kind it does not. */
export interface HeldItem {
  readonly known: UnmetCondition | undefined;
  readonly rawKind: string | undefined;
}

function parsePlainCondition(raw: unknown): UnmetPlainCondition | undefined {
  const parsed = plainConditionSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

function readRawKind(raw: unknown): HeldItem {
  const kind = isRecord(raw) ? raw["kind"] : undefined;
  return {
    known: undefined,
    rawKind: typeof kind === "string" ? kind : undefined,
  };
}

/** An `any` group keeps the members this build knows; with none it prints raw. */
function parseHeldItem(raw: unknown): HeldItem {
  const plain = parsePlainCondition(raw);
  if (plain !== undefined) {
    return { known: plain, rawKind: undefined };
  }
  const group = anyGroupSchema.safeParse(raw);
  if (!group.success) {
    return readRawKind(raw);
  }
  const conditions = group.data.conditions.flatMap((member) => {
    const parsed = parsePlainCondition(member);
    return parsed === undefined ? [] : [parsed];
  });
  if (conditions.length === 0) {
    return readRawKind(raw);
  }
  const known = { kind: UnmetConditionKinds.ANY, conditions };
  return { known, rawKind: undefined };
}

/** The meta's unmet items, read item by item so one unknown never hides the rest. */
export function parseHeldItems(raw: unknown): HeldItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map(parseHeldItem);
}
