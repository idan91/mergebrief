import { createHash } from "node:crypto";
import {
  GitHubAccountTypes,
  TRUSTED_AUTHOR_ASSOCIATIONS,
  type SubmittedReview,
} from "github";
import { matchesAnyGlob } from "brief-core/path-matching";
import type { Logger } from "logging";
import {
  type EffectiveTriggerConditions,
  type SizeBounds,
  type EffectiveCondition,
  type TriggerConditionSetting,
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
import type { Mutable } from "types/utils";

import { checkBots } from "./bots";
import { checkCi } from "./ci";
import {
  type ConditionFacts,
  type KindCheck,
  type KindCheckInput,
} from "./types";
import { isKindConfigured, listSettings } from "./utils";

type KindChecks = {
  readonly [Kind in TriggerConditionKind]?: KindCheck<Kind>;
};

interface KindSetting<Kind extends TriggerConditionKind> {
  readonly kind: Kind;
  readonly value: TriggerConditionValues[Kind];
}

type PathsSetting = KindSetting<typeof TriggerConditionKinds.PATHS>;

/** The stamps a run writes for the sticky conditions it saw met by evidence, not by a stamp. */
export interface OwedStamps {
  readonly reviewRequested: boolean;
  /** The current `paths` globs' digest, when a changed path matched them. */
  readonly pathsDigest?: string;
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

/**
 * A bot's review is a tool's and the author's own is no reviewer's. Only
 * invited people see a private repository, so any other review there counts;
 * elsewhere only a trusted association does. The api's permission read for
 * an untrusted one is not made here: its review webhook stamps that reviewer.
 */
function isTeamReview(review: SubmittedReview, facts: ConditionFacts): boolean {
  if (review.authorType === GitHubAccountTypes.BOT) {
    return false;
  }
  const byAuthor =
    review.authorLogin !== undefined &&
    review.authorLogin === facts.authorLogin;
  if (byAuthor) {
    return false;
  }
  if (facts.repoPrivate) {
    return true;
  }
  const association = review.authorAssociation;
  return (
    association !== undefined && TRUSTED_AUTHOR_ASSOCIATIONS.has(association)
  );
}

/** A pending request, or a team member's review after GitHub dropped theirs. */
function isReviewRequestSeen(facts: ConditionFacts): boolean {
  if (facts.pendingReviewRequests > 0) {
    return true;
  }
  return facts.reports.reviews.some((review) => isTeamReview(review, facts));
}

function checkReviewRequested({
  setBy,
  facts,
}: KindCheckInput<
  typeof TriggerConditionKinds.REVIEW_REQUESTED
>): UnmetPlainCondition[] {
  const stamped = facts.stamps.reviewRequestedMetAt !== undefined;
  if (stamped || isReviewRequestSeen(facts)) {
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

/**
 * One scan's steps, glob tokens x path length, the globs a repository
 * writer's and the paths a PR author's: sized for 6000 paths of 200
 * characters, 3000 files each renamed, against a few general globs.
 */
const PATHS_MATCH_STEPS = 40_000_000;

/** Sorted and deduplicated first, so only an edit to the set of globs checks again. */
export function digestPathGlobs(globs: readonly string[]): string {
  const unique = [...new Set(globs)];
  const canonical = JSON.stringify(unique.toSorted());
  return createHash("sha256").update(canonical).digest("hex");
}

function isPathsStampCurrent(
  globs: readonly string[],
  facts: ConditionFacts,
): boolean {
  const stamped = facts.stamps.pathsMetDigest;
  return stamped !== undefined && stamped === digestPathGlobs(globs);
}

/** Every changed file's own path first, then each rename's old one. */
function matchChangedPaths(
  globs: readonly string[],
  changedPaths: readonly string[],
  facts: ConditionFacts,
): boolean | undefined {
  return matchesAnyGlob(
    globs,
    [changedPaths, facts.previousPaths ?? []],
    PATHS_MATCH_STEPS,
  );
}

/** No path was read: `paths` reads as met. */
function isPathsUnseen(facts: ConditionFacts): boolean {
  return facts.changedPaths === undefined;
}

/**
 * Git paths are case-sensitive, so a glob matches as written. A stamp under
 * the same globs meets it before any path is read. A scan past its budget
 * reads as unmet: the head holds, nothing is spent, and a Generate click
 * still runs it. Unread paths read as met: the list is read only when the
 * verdict turns on it (`isVerdictOnPaths`), so a head held on another
 * condition lists no `paths` item, nor an `any` group holding one, until the
 * others pass. GitHub lists at most 3,000 files, so a larger PR matches on
 * those alone. The match is the one `addPathsMatch` scanned.
 */
function checkPaths({
  value,
  setBy,
  facts,
}: KindCheckInput<typeof TriggerConditionKinds.PATHS>): UnmetPlainCondition[] {
  if (isPathsStampCurrent(value, facts) || isPathsUnseen(facts)) {
    return [];
  }
  if (facts.pathsMatched === true) {
    return [];
  }
  return [{ kind: TriggerConditionKinds.PATHS, setBy, paths: value }];
}

/** Each kind's check; a kind without one here is met. */
const KIND_CHECKS: KindChecks = {
  [TriggerConditionKinds.READY_FOR_REVIEW]: checkReadyForReview,
  [TriggerConditionKinds.NEVER]: checkNever,
  [TriggerConditionKinds.SIZE]: checkSize,
  [TriggerConditionKinds.BOTS]: checkBots,
  [TriggerConditionKinds.REVIEW_REQUESTED]: checkReviewRequested,
  [TriggerConditionKinds.CI]: checkCi,
  [TriggerConditionKinds.PATHS]: checkPaths,
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

function isPathsSetting(
  setting: TriggerConditionSetting,
): setting is PathsSetting {
  return setting.kind === TriggerConditionKinds.PATHS;
}

/** A `paths` condition no stamp meets, so only the changed paths can. */
function isUnstampedPaths(
  condition: EffectiveCondition,
  facts: ConditionFacts,
): boolean {
  const { setting } = condition;
  if (!isPathsSetting(setting)) {
    return false;
  }
  return !isPathsStampCurrent(setting.value, facts);
}

function isConditionMet(
  condition: EffectiveCondition,
  facts: ConditionFacts,
): boolean {
  return checkCondition(condition, facts).length === 0;
}

function isAnyGroupHolding(
  effective: EffectiveTriggerConditions,
  facts: ConditionFacts,
): boolean {
  const { any } = effective;
  const hasPathsMember = any.some((item) => isPathsSetting(item.setting));
  if (any.length === 0 || hasPathsMember) {
    return false;
  }
  return any.every((item) => !isConditionMet(item, facts));
}

/**
 * Whether the changed paths can decide the verdict, judged on the other
 * conditions alone: not while another plain condition holds the head
 * anyway, nor while an `any` group without `paths` holds it, and not for an
 * `any` group another member already meets. `facts` must carry the head's
 * reports, so a `bots` or `ci` member is decided here.
 */
export function isVerdictOnPaths(
  effective: EffectiveTriggerConditions,
  facts: ConditionFacts,
): boolean {
  const isOnPaths = (item: EffectiveCondition) => isUnstampedPaths(item, facts);
  const plain = effective.all.filter((item) => !isOnPaths(item));
  const plainMet = plain.every((item) => isConditionMet(item, facts));
  if (!plainMet) {
    return false;
  }
  if (effective.all.some(isOnPaths)) {
    return !isAnyGroupHolding(effective, facts);
  }
  if (!effective.any.some(isOnPaths)) {
    return false;
  }

  const others = effective.any.filter((item) => !isOnPaths(item));
  return !others.some((item) => isConditionMet(item, facts));
}

function findPathsSetting(
  effective: EffectiveTriggerConditions,
): PathsSetting | undefined {
  return listSettings(effective).find(isPathsSetting);
}

/**
 * The facts with the `paths` match scanned once for the run, so the verdict
 * and the owed stamp read one answer. Nothing is scanned when no path can
 * decide it: no `paths` condition, unread paths, or a stamp under the
 * current globs. A scan past its budget reads as no match and warns.
 */
export function addPathsMatch(
  effective: EffectiveTriggerConditions,
  facts: ConditionFacts,
  log?: Logger,
): ConditionFacts {
  const setting = findPathsSetting(effective);
  const { changedPaths } = facts;
  if (setting === undefined || changedPaths === undefined) {
    return facts;
  }
  if (isPathsStampCurrent(setting.value, facts)) {
    return facts;
  }

  const matched = matchChangedPaths(setting.value, changedPaths, facts);
  if (matched === undefined) {
    const previousCount = facts.previousPaths?.length ?? 0;
    log?.warn("generate: paths match budget spent, held as no match", {
      globs: setting.value.length,
      paths: changedPaths.length + previousCount,
    });
  }
  const pathsMatched = matched === true;
  return { ...facts, pathsMatched };
}

/** The globs' digest when a changed path matched them this run. */
function findMatchedPathsDigest(
  setting: PathsSetting,
  facts: ConditionFacts,
): string | undefined {
  if (facts.pathsMatched !== true) {
    return undefined;
  }
  return digestPathGlobs(setting.value);
}

/** What this run saw that keeps `reviewRequested` or `paths` met for the rest of the PR. */
export function deriveOwedStamps(
  effective: EffectiveTriggerConditions,
  facts: ConditionFacts,
): OwedStamps {
  const reviewRequestedSet = isKindConfigured(
    effective,
    TriggerConditionKinds.REVIEW_REQUESTED,
  );
  const reviewUnstamped = facts.stamps.reviewRequestedMetAt === undefined;
  const owed: Mutable<OwedStamps> = {
    reviewRequested:
      reviewRequestedSet && reviewUnstamped && isReviewRequestSeen(facts),
  };

  const paths = findPathsSetting(effective);
  const pathsDigest =
    paths === undefined ? undefined : findMatchedPathsDigest(paths, facts);
  if (pathsDigest !== undefined) {
    owed.pathsDigest = pathsDigest;
  }
  return owed;
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
