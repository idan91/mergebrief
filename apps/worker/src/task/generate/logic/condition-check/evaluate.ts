import { matchesGlob } from "brief-core/path-matching";
import type { Logger } from "logging";
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

import {
  PathsMatchOutcomes,
  type ConditionFacts,
  type PathsMatchOutcome,
} from "./types";

interface KindCheckInput<Kind extends TriggerConditionKind> {
  readonly value: TriggerConditionValues[Kind];
  readonly setBy: TriggerConditionSetter;
  readonly facts: ConditionFacts;
  readonly log?: Logger | undefined;
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
const OPENS_WITHOUT_SPACES_PATTERN =
  /^[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}]/u;
const CLOSES_WITHOUT_SPACES_PATTERN =
  /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}]$/u;

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
  return measures.flatMap((measure) => listMissedSizeBounds(measure, input));
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
 * An edge in a script written without spaces (Han, kana, Thai and kin) has
 * no word boundary to find, so it matches anywhere.
 */
function buildKeywordPattern(keyword: string): RegExp {
  const escaped = keyword.replace(REGEX_SYNTAX_PATTERN, "\\$&");
  const guardsStart =
    OPENS_ON_WORD_PATTERN.test(keyword) &&
    !OPENS_WITHOUT_SPACES_PATTERN.test(keyword);
  const guardsEnd =
    CLOSES_ON_WORD_PATTERN.test(keyword) &&
    !CLOSES_WITHOUT_SPACES_PATTERN.test(keyword);
  const before = guardsStart ? NOT_AFTER_WORD : "";
  const after = guardsEnd ? NOT_BEFORE_WORD : "";
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

/**
 * `matchesGlob` costs glob x path steps, the globs a repository writer's and
 * the paths a PR author's: sized as the gitattributes scan is, for 3000 paths
 * of 200 characters against a few general globs.
 */
const PATHS_MATCH_STEPS = 20_000_000;
const GLOB_SYNTAX_START = /[*?[{\\!]/;

/** A glob's literal ends: a path that lacks either cannot match. */
interface GlobFilter {
  readonly glob: string;
  readonly prefix: string;
  readonly suffix: string;
}

function readLiteralPrefix(glob: string): string {
  const wildcard = glob.search(GLOB_SYNTAX_START);
  return wildcard === -1 ? glob : glob.slice(0, wildcard);
}

/**
 * The index past the star token at `start`, read as `matchesGlob` reads it:
 * `*`, `**`, or `**\/`, whose slash the token consumes, since it can match
 * zero directories.
 */
function skipStarToken(glob: string, start: number): number {
  if (glob[start + 1] !== "*") {
    return start + 1;
  }
  if (glob[start + 2] === "/") {
    return start + 3;
  }
  return start + 2;
}

function findLiteralTailStart(glob: string): number {
  let tailStart = 0;
  let index = 0;
  while (index < glob.length) {
    const char = glob[index];
    if (char === "*") {
      index = skipStarToken(glob, index);
      tailStart = index;
      continue;
    }
    index += 1;
    if (char === "?") {
      tailStart = index;
    }
  }
  return tailStart;
}

/** The characters after a glob's last wildcard token, empty when they hold any glob syntax. */
function readLiteralSuffix(glob: string): string {
  const tail = glob.slice(findLiteralTailStart(glob));
  return GLOB_SYNTAX_START.test(tail) ? "" : tail;
}

/** The longest literal prefix first: it narrows the scan most. */
function orderGlobFilters(globs: readonly string[]): GlobFilter[] {
  const filters = globs.map((glob) => ({
    glob,
    prefix: readLiteralPrefix(glob),
    suffix: readLiteralSuffix(glob),
  }));
  return filters.toSorted(
    (left, right) => right.prefix.length - left.prefix.length,
  );
}

function passesGlobFilter(filter: GlobFilter, path: string): boolean {
  return path.startsWith(filter.prefix) && path.endsWith(filter.suffix);
}

/**
 * Whether any glob matches any changed path, or a spent budget once the scan
 * runs out of steps. A path missing the glob's literal prefix or suffix costs
 * no steps.
 */
function matchPaths(
  globs: readonly string[],
  paths: readonly string[],
): PathsMatchOutcome {
  let steps = PATHS_MATCH_STEPS;
  for (const filter of orderGlobFilters(globs)) {
    for (const path of paths) {
      if (!passesGlobFilter(filter, path)) {
        continue;
      }
      steps -= filter.glob.length * (path.length + 1);
      if (steps < 0) {
        return PathsMatchOutcomes.BUDGET_SPENT;
      }
      if (matchesGlob(filter.glob, path)) {
        return PathsMatchOutcomes.MATCHED;
      }
    }
  }
  return PathsMatchOutcomes.UNMATCHED;
}

/**
 * Git paths are case-sensitive, so a glob matches as written. A scan past
 * its budget reads as unmet and warns: the head holds, nothing is spent, and
 * a Generate click still runs it. Unread paths read as met: the list is read
 * only when the verdict turns on it (`isVerdictOnPaths`), so a head held on
 * another condition lists no `paths` item, nor an `any` group holding one,
 * until the others pass.
 */
function checkPaths({
  value,
  setBy,
  facts,
  log,
}: KindCheckInput<typeof TriggerConditionKinds.PATHS>): UnmetPlainCondition[] {
  if (facts.changedPaths === undefined) {
    return [];
  }
  const outcome = matchPaths(value, facts.changedPaths);
  if (outcome === PathsMatchOutcomes.MATCHED) {
    return [];
  }
  if (outcome === PathsMatchOutcomes.BUDGET_SPENT) {
    log?.warn("generate: paths match budget spent, held as no match", {
      globs: value.length,
      paths: facts.changedPaths.length,
    });
  }
  return [{ kind: TriggerConditionKinds.PATHS, setBy, paths: value }];
}

/** Each kind's check; a kind without one here is met. */
const KIND_CHECKS: KindChecks = {
  [TriggerConditionKinds.READY_FOR_REVIEW]: checkReadyForReview,
  [TriggerConditionKinds.NEVER]: checkNever,
  [TriggerConditionKinds.SIZE]: checkSize,
  [TriggerConditionKinds.REVIEW_REQUESTED]: checkReviewRequested,
  [TriggerConditionKinds.PATHS]: checkPaths,
  [TriggerConditionKinds.LABELS]: checkLabels,
  [TriggerConditionKinds.TITLE_KEYWORDS]: checkTitleKeywords,
  [TriggerConditionKinds.BASE_BRANCHES]: checkBaseBranches,
};

function runKindCheck<Kind extends TriggerConditionKind>(
  setting: KindSetting<Kind>,
  setBy: TriggerConditionSetter,
  facts: ConditionFacts,
  log?: Logger,
): UnmetPlainCondition[] {
  const check: KindCheck<Kind> | undefined = KIND_CHECKS[setting.kind];
  if (check === undefined) {
    return [];
  }
  return check({ value: setting.value, setBy, facts, log });
}

function checkCondition(
  condition: EffectiveCondition,
  facts: ConditionFacts,
  log?: Logger,
): UnmetPlainCondition[] {
  return runKindCheck(condition.setting, condition.setBy, facts, log);
}

function isPathsCondition(condition: EffectiveCondition): boolean {
  return condition.setting.kind === TriggerConditionKinds.PATHS;
}

function isConditionMet(
  condition: EffectiveCondition,
  facts: ConditionFacts,
): boolean {
  return checkCondition(condition, facts).length === 0;
}

/**
 * Whether the changed paths can decide the verdict, judged on the other
 * conditions alone: not while another plain condition holds the head
 * anyway, and not for an `any` group another member already meets.
 */
export function isVerdictOnPaths(
  effective: EffectiveTriggerConditions,
  facts: ConditionFacts,
): boolean {
  const plain = effective.all.filter((item) => !isPathsCondition(item));
  const plainMet = plain.every((item) => isConditionMet(item, facts));
  if (!plainMet) {
    return false;
  }
  if (effective.all.some(isPathsCondition)) {
    return true;
  }
  if (!effective.any.some(isPathsCondition)) {
    return false;
  }

  const others = effective.any.filter((item) => !isPathsCondition(item));
  return !others.some((item) => isConditionMet(item, facts));
}

/**
 * Every unmet item, in configured order, an unmet `any` group last: every
 * plain condition must pass, and one member of the group is enough.
 */
export function evaluateTriggerConditions(
  effective: EffectiveTriggerConditions,
  facts: ConditionFacts,
  log?: Logger,
): UnmetCondition[] {
  const unmet: UnmetCondition[] = effective.all.flatMap((condition) =>
    checkCondition(condition, facts, log),
  );
  if (effective.any.length === 0) {
    return unmet;
  }

  const members = effective.any.map((condition) =>
    checkCondition(condition, facts, log),
  );
  const groupMet = members.some((items) => items.length === 0);
  if (!groupMet) {
    unmet.push({ kind: UnmetConditionKinds.ANY, conditions: members.flat() });
  }
  return unmet;
}
