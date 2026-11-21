import {
  type EffectiveTriggerConditions,
  type SizeBounds,
  type EffectiveCondition,
  type TriggerConditionValues,
} from "generators/trigger-conditions";
import {
  SizeBoundSides,
  SizeMeasures,
  TriggerConditionKinds,
  UnmetConditionKinds,
  type SizeBoundSide,
  type SizeMeasure,
  type TriggerConditionKind,
  type TriggerConditionSetter,
  type UnmetCondition,
  type UnmetPlainCondition,
} from "types/trigger-conditions";

import type { ConditionFacts } from "./types";

interface KindCheckInput<Kind extends TriggerConditionKind> {
  readonly value: TriggerConditionValues[Kind];
  readonly setBy: TriggerConditionSetter;
  readonly facts: ConditionFacts;
}

/** A kind's check: the unmet items it leaves, none when the push meets it. */
type KindCheck<Kind extends TriggerConditionKind> = (
  input: KindCheckInput<Kind>,
) => UnmetPlainCondition[];

type KindChecks = {
  readonly [Kind in TriggerConditionKind]?: KindCheck<Kind>;
};

interface KindSetting<Kind extends TriggerConditionKind> {
  readonly kind: Kind;
  readonly value: TriggerConditionValues[Kind];
}

interface MissedBound {
  readonly side: SizeBoundSide;
  readonly limit: number;
}

const REGEX_SYNTAX_PATTERN = /[\\^$.*+?()[\]{}|/]/g;
const OPENS_ON_WORD_PATTERN = /^[\p{L}\p{N}_]/u;
const CLOSES_ON_WORD_PATTERN = /[\p{L}\p{N}_]$/u;
const NOT_AFTER_WORD = "(?<![\\p{L}\\p{N}_])";
const NOT_BEFORE_WORD = "(?![\\p{L}\\p{N}_])";

function checkReadyForReview({
  setBy,
  facts,
}: KindCheckInput<
  typeof TriggerConditionKinds.READY_FOR_REVIEW
>): UnmetPlainCondition[] {
  if (!facts.draft) {
    return [];
  }
  return [{ kind: TriggerConditionKinds.READY_FOR_REVIEW, setBy }];
}

function checkNever({
  setBy,
}: KindCheckInput<typeof TriggerConditionKinds.NEVER>): UnmetPlainCondition[] {
  return [{ kind: TriggerConditionKinds.NEVER, setBy }];
}

/** Both bounds are inclusive. */
function findMissedBounds(bounds: SizeBounds, actual: number): MissedBound[] {
  const missed: MissedBound[] = [];
  const belowMin = bounds.min !== undefined && actual < bounds.min;
  const aboveMax = bounds.max !== undefined && actual > bounds.max;
  if (belowMin) {
    missed.push({ side: SizeBoundSides.MIN, limit: bounds.min });
  }
  if (aboveMax) {
    missed.push({ side: SizeBoundSides.MAX, limit: bounds.max });
  }
  return missed;
}

function listMissedSizeBounds(
  measure: SizeMeasure,
  input: KindCheckInput<typeof TriggerConditionKinds.SIZE>,
): UnmetPlainCondition[] {
  const bounds = input.value[measure];
  if (bounds === undefined) {
    return [];
  }

  const actual = input.facts.sizes[measure];
  return findMissedBounds(bounds, actual).map(({ side, limit }) => ({
    kind: TriggerConditionKinds.SIZE,
    setBy: input.setBy,
    measure,
    side,
    limit,
    actual,
  }));
}

/** One item per missed bound, in changedLines, additions, deletions order whatever the YAML lists. */
function checkSize(
  input: KindCheckInput<typeof TriggerConditionKinds.SIZE>,
): UnmetPlainCondition[] {
  const measures = Object.values(SizeMeasures);
  return measures.flatMap((measure) =>
    listMissedSizeBounds(measure, input),
  );
}

function checkReviewRequested({
  setBy,
  facts,
}: KindCheckInput<
  typeof TriggerConditionKinds.REVIEW_REQUESTED
>): UnmetPlainCondition[] {
  if (facts.pendingReviewRequests > 0) {
    return [];
  }
  return [{ kind: TriggerConditionKinds.REVIEW_REQUESTED, setBy }];
}

/** GitHub refuses two labels whose names differ only by case, so case never tells two apart. */
function foldLabelCase(label: string): string {
  return label.toLowerCase();
}

function checkLabels({
  value,
  setBy,
  facts,
}: KindCheckInput<typeof TriggerConditionKinds.LABELS>): UnmetPlainCondition[] {
  const carried = new Set(facts.labels.map(foldLabelCase));
  const wanted = value.map(foldLabelCase);
  const met = wanted.some((label) => carried.has(label));
  if (met) {
    return [];
  }
  return [{ kind: TriggerConditionKinds.LABELS, setBy, labels: value }];
}

/**
 * A keyword matches as a whole word, ignoring case: an edge that is a letter,
 * digit or underscore must not continue into one, so `wip` misses `Wipe`.
 */
function buildKeywordPattern(keyword: string): RegExp {
  const escaped = keyword.replace(REGEX_SYNTAX_PATTERN, "\\$&");
  const before = OPENS_ON_WORD_PATTERN.test(keyword) ? NOT_AFTER_WORD : "";
  const after = CLOSES_ON_WORD_PATTERN.test(keyword) ? NOT_BEFORE_WORD : "";
  return new RegExp(`${before}${escaped}${after}`, "iu");
}

function isKeywordInTitle(keyword: string, title: string): boolean {
  const pattern = buildKeywordPattern(keyword);
  return pattern.test(title);
}

function checkTitleKeywords({
  value,
  setBy,
  facts,
}: KindCheckInput<
  typeof TriggerConditionKinds.TITLE_KEYWORDS
>): UnmetPlainCondition[] {
  const met = value.some((keyword) => isKeywordInTitle(keyword, facts.title));
  if (met) {
    return [];
  }
  return [
    { kind: TriggerConditionKinds.TITLE_KEYWORDS, setBy, keywords: value },
  ];
}

/**
 * Git branch names are case-sensitive, so the match is exact. A base GitHub
 * did not name matches no branch, and its item names none.
 */
function checkBaseBranches({
  value,
  setBy,
  facts,
}: KindCheckInput<
  typeof TriggerConditionKinds.BASE_BRANCHES
>): UnmetPlainCondition[] {
  const { baseRef } = facts;
  if (baseRef === undefined) {
    return [
      { kind: TriggerConditionKinds.BASE_BRANCHES, setBy, branches: value },
    ];
  }
  if (value.includes(baseRef)) {
    return [];
  }
  return [
    {
      kind: TriggerConditionKinds.BASE_BRANCHES,
      setBy,
      base: baseRef,
      branches: value,
    },
  ];
}

/** Each kind's check; a kind without one here is met. */
const KIND_CHECKS: KindChecks = {
  [TriggerConditionKinds.READY_FOR_REVIEW]: checkReadyForReview,
  [TriggerConditionKinds.NEVER]: checkNever,
  [TriggerConditionKinds.SIZE]: checkSize,
  [TriggerConditionKinds.REVIEW_REQUESTED]: checkReviewRequested,
  [TriggerConditionKinds.LABELS]: checkLabels,
  [TriggerConditionKinds.TITLE_KEYWORDS]: checkTitleKeywords,
  [TriggerConditionKinds.BASE_BRANCHES]: checkBaseBranches,
};

function runKindCheck<Kind extends TriggerConditionKind>(
  setting: KindSetting<Kind>,
  setBy: TriggerConditionSetter,
  facts: ConditionFacts,
): UnmetPlainCondition[] {
  const check: KindCheck<Kind> | undefined = KIND_CHECKS[setting.kind];
  if (check === undefined) {
    return [];
  }
  return check({ value: setting.value, setBy, facts });
}

function checkCondition(
  condition: EffectiveCondition,
  facts: ConditionFacts,
): UnmetPlainCondition[] {
  return runKindCheck(condition.setting, condition.setBy, facts);
}

/**
 * Every unmet item, in configured order, an unmet `any` group last: every
 * plain condition must pass, and one member of the group is enough.
 */
export function evaluateTriggerConditions(
  effective: EffectiveTriggerConditions,
  facts: ConditionFacts,
): UnmetCondition[] {
  const unmet: UnmetCondition[] = effective.all.flatMap((condition) =>
    checkCondition(condition, facts),
  );
  if (effective.any.length === 0) {
    return unmet;
  }

  const members = effective.any.map((condition) =>
    checkCondition(condition, facts),
  );
  const groupMet = members.some((items) => items.length === 0);
  if (!groupMet) {
    unmet.push({ kind: UnmetConditionKinds.ANY, conditions: members.flat() });
  }
  return unmet;
}
