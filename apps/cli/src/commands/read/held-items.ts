import { z } from "zod/v4";
import {
  BotStates,
  ReviewBots,
  SizeBoundSides,
  SizeMeasures,
  TriggerConditionKinds,
  TriggerConditionSetters,
  UnmetConditionKinds,
} from "types/trigger-conditions";
import { isRecord } from "../../utils";

const setBySchema = z.enum(TriggerConditionSetters);
const namesSchema = z.array(z.string()).readonly();

/** One condition this build knows; a bot's verdict is never printed, so it is not read. */
export const heldPlainConditionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal(TriggerConditionKinds.READY_FOR_REVIEW),
    setBy: setBySchema,
  }),
  z.object({
    kind: z.literal(TriggerConditionKinds.NEVER),
    setBy: setBySchema,
  }),
  z.object({
    kind: z.literal(TriggerConditionKinds.REVIEW_REQUESTED),
    setBy: setBySchema,
  }),
  z.object({
    kind: z.literal(TriggerConditionKinds.SIZE),
    setBy: setBySchema,
    measure: z.enum(SizeMeasures),
    side: z.enum(SizeBoundSides),
    limit: z.number(),
    actual: z.number(),
  }),
  z.object({
    kind: z.literal(TriggerConditionKinds.LABELS),
    setBy: setBySchema,
    labels: namesSchema,
  }),
  z.object({
    kind: z.literal(TriggerConditionKinds.TITLE_KEYWORDS),
    setBy: setBySchema,
    keywords: namesSchema,
  }),
  z.object({
    kind: z.literal(TriggerConditionKinds.BASE_BRANCHES),
    setBy: setBySchema,
    base: z.string().exactOptional(),
    branches: namesSchema,
  }),
  z.object({
    kind: z.literal(TriggerConditionKinds.PATHS),
    setBy: setBySchema,
    paths: namesSchema,
  }),
  z.object({
    kind: z.literal(TriggerConditionKinds.BOTS),
    setBy: setBySchema,
    bot: z.enum(ReviewBots),
    state: z.enum(BotStates),
    issues: z.number().exactOptional(),
  }),
  z.object({
    kind: z.literal(TriggerConditionKinds.CI),
    setBy: setBySchema,
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

export type HeldPlainCondition = z.output<typeof heldPlainConditionSchema>;

/** An `any` group: the members this build knows, and the kinds of those it does not. */
interface HeldAnyGroup {
  readonly kind: typeof UnmetConditionKinds.ANY;
  readonly conditions: readonly HeldPlainCondition[];
  readonly rawKinds: readonly string[];
}

export type HeldCondition = HeldPlainCondition | HeldAnyGroup;

/** One unmet item as this build reads it: a condition it knows, or the kind it does not. */
export interface HeldItem {
  readonly known: HeldCondition | undefined;
  readonly rawKind: string | undefined;
}

function parsePlainCondition(raw: unknown): HeldPlainCondition | undefined {
  const parsed = heldPlainConditionSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

function readKind(raw: unknown): string | undefined {
  const kind = isRecord(raw) ? raw["kind"] : undefined;
  return typeof kind === "string" ? kind : undefined;
}

function readRawKind(raw: unknown): HeldItem {
  return { known: undefined, rawKind: readKind(raw) };
}

function readAnyGroup(members: readonly unknown[]): HeldAnyGroup {
  const conditions: HeldPlainCondition[] = [];
  const rawKinds: string[] = [];
  for (const member of members) {
    const parsed = parsePlainCondition(member);
    const kind = readKind(member);
    if (parsed !== undefined) {
      conditions.push(parsed);
    } else if (kind !== undefined) {
      rawKinds.push(kind);
    }
  }
  return { kind: UnmetConditionKinds.ANY, conditions, rawKinds };
}

/**
 * An `any` group keeps the members this build knows and the raw kinds of
 * those it does not; with neither it prints raw.
 */
function parseHeldItem(raw: unknown): HeldItem {
  const plain = parsePlainCondition(raw);
  if (plain !== undefined) {
    return { known: plain, rawKind: undefined };
  }
  const group = anyGroupSchema.safeParse(raw);
  if (!group.success) {
    return readRawKind(raw);
  }

  const known = readAnyGroup(group.data.conditions);
  const readsNoMember =
    known.conditions.length === 0 && known.rawKinds.length === 0;
  if (readsNoMember) {
    return readRawKind(raw);
  }
  return { known, rawKind: undefined };
}

/** The meta's unmet items, read item by item so one unknown never hides the rest. */
export function parseHeldItems(raw: unknown): HeldItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map(parseHeldItem);
}
