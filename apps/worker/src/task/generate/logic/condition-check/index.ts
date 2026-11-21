import {
  GitHubApiErrorCodes,
  type CheckRun,
  type CommitStatus,
  type GitHubCall,
  type GitHubCallFailure,
  type PullRequestFile,
  type SubmittedReview,
} from "github";
import {
  CiModes,
  resolveEffectiveTriggerConditions,
  type EffectiveTriggerConditions,
  type TriggerConditionSetting,
} from "generators/trigger-conditions";
import {
  SizeMeasures,
  TriggerConditionKinds,
  type TriggerConditionKind,
} from "types/trigger-conditions";
import type { Mutable, Result } from "types/utils";
import type { AcquiredRepoConfig } from "../../../repo-config";
import {
  ConditionCheckKinds,
  type ConditionCheckOutcome,
  type RunContext,
} from "../../types";
import type { ConditionReads } from "../../../github-port";
import { throwOnGitHubFailure } from "../errors";
import { REVIEW_BOT_ACCOUNTS } from "./consts";
import { acquireGateRepoConfig, isGateable } from "../run-gates";
import {
  evaluateTriggerConditions,
  isPastFilesList,
  isVerdictOnPaths,
} from "./evaluate";
import { isBoundForLargePool } from "../pool-routing";
import { postHeldEntry } from "./held-entry";
import type { ConditionFacts, HeadReports } from "./types";
import { isReviewBot } from "./utils";

const HELD: ConditionCheckOutcome = { kind: ConditionCheckKinds.HELD };

function buildProceedOutcome(
  repoConfig: AcquiredRepoConfig | undefined,
  files?: readonly PullRequestFile[],
): ConditionCheckOutcome {
  return { kind: ConditionCheckKinds.PROCEED, repoConfig, files };
}

/**
 * A gateable run, unless a Generate click stamped its head or the PR
 * generates on every push, which skips the conditions for every head.
 */
function isCheckable(context: RunContext): boolean {
  const { projected, prRow } = context;
  const stamped =
    projected !== undefined && projected.generateRequestedAt !== null;
  const everyPush = prRow.generateEveryPushAt !== null;
  const checkable = isGateable(context) && !stamped && !everyPush;
  return checkable;
}

/** The switch went on after pickup read the row; the store refused the hold under its lock. */
async function isEveryPushTurnedOnSincePickup(
  context: RunContext,
): Promise<boolean> {
  const row = await context.repo.pullRequests.getById(context.prRow.id);
  return row !== undefined && row.generateEveryPushAt !== null;
}

function listSettings(
  effective: EffectiveTriggerConditions,
): TriggerConditionSetting[] {
  const conditions = [...effective.all, ...effective.any];
  return conditions.map((condition) => condition.setting);
}

function isKindConfigured(
  effective: EffectiveTriggerConditions,
  kind: TriggerConditionKind,
): boolean {
  return listSettings(effective).some((setting) => setting.kind === kind);
}

/**
 * A bot with an App reports by check run or status. Copilot reports only by
 * review, so a `bots` condition naming it alone reads neither.
 */
function isAppBotConfigured(effective: EffectiveTriggerConditions): boolean {
  return listSettings(effective).some((setting) => {
    if (setting.kind !== TriggerConditionKinds.BOTS) {
      return false;
    }
    const bots = Object.keys(setting.value).filter(isReviewBot);
    return bots.some((bot) => REVIEW_BOT_ACCOUNTS[bot].appId !== undefined);
  });
}

function isRulesetRead(effective: EffectiveTriggerConditions): boolean {
  return listSettings(effective).some(
    (setting) =>
      setting.kind === TriggerConditionKinds.CI &&
      setting.value.mode === CiModes.REQUIRED,
  );
}

/**
 * Only a `paths` condition that can decide the verdict reads the file list
 * this early: not in a run about to move to the large pool, where unread
 * paths read as met, so that run routes and the large pool's run reads the
 * list once and decides, and not for a PR past GitHub's file list, which
 * meets it. A failure classifies as the run's own later read would: a
 * transient one retries before any hold, so no head is held on a list it
 * never saw.
 */
async function readCheckedFiles(
  context: RunContext,
  effective: EffectiveTriggerConditions,
  facts: ConditionFacts,
): Promise<readonly PullRequestFile[] | undefined> {
  const pathsDecide = isVerdictOnPaths(effective, facts);
  const filesWait = !pathsDecide || isBoundForLargePool(context);
  if (filesWait) {
    return undefined;
  }
  if (isPastFilesList(facts)) {
    context.log.debug("generate: paths met past the file list cap", {
      changedFiles: facts.changedFileCount,
    });
    return undefined;
  }
  return throwOnGitHubFailure(await context.source.fetchPullRequestFiles());
}

function listFilePaths(file: PullRequestFile): string[] {
  if (file.previousPath === undefined) {
    return [file.path];
  }
  return [file.path, file.previousPath];
}

const NO_REPORTS: HeadReports = {
  checkRuns: [],
  statuses: [],
  statusChecksForbidden: false,
  reviews: [],
  requiredChecks: [],
};

interface PermittedList<Item> {
  readonly items: readonly Item[];
  readonly forbidden: boolean;
}

function answerNothing<Item>(): GitHubCall<Item[]> {
  return Promise.resolve({ ok: true, value: [] });
}

/** A 403 is a permission the installation has not accepted, never a failed read. */
function readPermittedList<Item>(
  result: Result<Item[], GitHubCallFailure>,
): PermittedList<Item> {
  if (!result.ok && result.error.code === GitHubApiErrorCodes.FORBIDDEN) {
    return { items: [], forbidden: true };
  }
  return { items: throwOnGitHubFailure(result), forbidden: false };
}

function requireConditionReads(context: RunContext): ConditionReads {
  const reads = context.source.conditionReads;
  if (reads === undefined) {
    throw new Error("a checked run has no condition reads");
  }
  return reads;
}

/**
 * Only a `bots` or `ci` condition reads the head's reports, each read once.
 * A refused check-run or status read marks the permission missing; any
 * other failure classifies as the paths read does.
 */
async function readHeadReports(
  context: RunContext,
  effective: EffectiveTriggerConditions,
): Promise<HeadReports> {
  const botsSet = isKindConfigured(effective, TriggerConditionKinds.BOTS);
  const ciSet = isKindConfigured(effective, TriggerConditionKinds.CI);
  if (!botsSet && !ciSet) {
    return NO_REPORTS;
  }

  const reads = requireConditionReads(context);
  const { headSha, baseRef } = context.prInfo;
  const readsRuleset = isRulesetRead(effective) && baseRef !== undefined;
  const readsReports = ciSet || isAppBotConfigured(effective);
  const [runs, statuses, reviews, required] = await Promise.all([
    readsReports ? reads.listCheckRuns(headSha) : answerNothing<CheckRun>(),
    readsReports
      ? reads.listCommitStatuses(headSha)
      : answerNothing<CommitStatus>(),
    botsSet ? reads.listSubmittedReviews() : answerNothing<SubmittedReview>(),
    readsRuleset
      ? reads.listRequiredStatusChecks(baseRef)
      : answerNothing<string>(),
  ]);

  const permittedRuns = readPermittedList(runs);
  const permittedStatuses = readPermittedList(statuses);
  const statusChecksForbidden =
    permittedRuns.forbidden || permittedStatuses.forbidden;
  return {
    checkRuns: permittedRuns.items,
    statuses: permittedStatuses.items,
    statusChecksForbidden,
    reviews: throwOnGitHubFailure(reviews),
    requiredChecks: throwOnGitHubFailure(required),
  };
}

function readConditionFacts(
  context: RunContext,
  files: readonly PullRequestFile[] | undefined,
  reports: HeadReports,
): ConditionFacts {
  const { prInfo } = context;
  const changedLines = prInfo.additions + prInfo.deletions;
  const facts: Mutable<ConditionFacts> = {
    draft: prInfo.draft,
    title: prInfo.title,
    headSha: prInfo.headSha,
    labels: prInfo.labels,
    pendingReviewRequests: prInfo.pendingReviewRequests,
    sizes: {
      [SizeMeasures.CHANGED_LINES]: changedLines,
      [SizeMeasures.ADDITIONS]: prInfo.additions,
      [SizeMeasures.DELETIONS]: prInfo.deletions,
    },
    changedFileCount: prInfo.changedFiles,
    changedPaths: files?.flatMap(listFilePaths),
    reports,
  };
  if (prInfo.baseRef !== undefined) {
    facts.baseRef = prInfo.baseRef;
  }
  return facts;
}

/**
 * Whether the run may go on to its claim. The instance's and the default
 * branch's conditions merge per kind; a repo settings read a retry may
 * clear is tried again in the run, and a refused or last read applies the
 * instance's alone. An unmet condition holds the row and ends the run:
 * no claim, no attempt, no model. A hold the store refuses (a Generate
 * click, a live claim, a kept status) stands the run down the same way;
 * the click's own job runs the head, but a PR turned to every push goes on
 * to the claim, since the switch queues a job only for a head it finds held.
 * A held head gets the held Entry.
 */
export async function applyConditionCheck(
  context: RunContext,
  gateRepoConfig: AcquiredRepoConfig | undefined,
): Promise<ConditionCheckOutcome> {
  if (!isCheckable(context)) {
    return buildProceedOutcome(gateRepoConfig);
  }

  const { deps, log, projection, target } = context;
  const repoConfig = gateRepoConfig ?? (await acquireGateRepoConfig(context));
  const effective = resolveEffectiveTriggerConditions(
    deps.triggerConditions,
    repoConfig.settings?.triggerConditions,
  );
  const reports = await readHeadReports(context, effective);
  const unreadFacts = readConditionFacts(context, undefined, reports);
  const files = await readCheckedFiles(context, effective, unreadFacts);
  const unmet = evaluateTriggerConditions(
    effective,
    readConditionFacts(context, files, reports),
    log,
  );
  if (unmet.length === 0) {
    return buildProceedOutcome(repoConfig, files);
  }

  const held = await projection.markHeld(target, unmet);
  if (!held.ok) {
    if (await isEveryPushTurnedOnSincePickup(context)) {
      return buildProceedOutcome(repoConfig, files);
    }
    log.info("generate: condition hold stood down", { code: held.error.code });
    return HELD;
  }
  log.info("generate: head held on trigger conditions", {
    evt: "generation.hold",
    kinds: unmet.map((item) => item.kind),
  });
  await postHeldEntry(context, repoConfig, unmet);
  return HELD;
}
