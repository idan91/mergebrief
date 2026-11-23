import {
  CheckRunConclusions,
  CommitStatusStates,
  GitHubAccountTypes,
  type CheckRun,
  type CommitStatus,
  type CommitStatusState,
  type RequiredStatusCheck,
} from "github";
import { CiModes } from "generators/trigger-conditions";
import {
  TriggerConditionKinds,
  type UnmetPlainCondition,
} from "types/trigger-conditions";

import {
  CheckOutcomes,
  type CheckOutcome,
  type CheckReading,
  type HeadReports,
  type KindCheckInput,
} from "./types";
import { findLatestRun } from "./utils";

const PASSING_CONCLUSIONS: ReadonlySet<string> = new Set([
  CheckRunConclusions.SUCCESS,
  CheckRunConclusions.NEUTRAL,
  CheckRunConclusions.SKIPPED,
]);

const STATUS_OUTCOMES: Readonly<Record<CommitStatusState, CheckOutcome>> = {
  [CommitStatusStates.SUCCESS]: CheckOutcomes.PASSED,
  [CommitStatusStates.PENDING]: CheckOutcomes.RUNNING,
  [CommitStatusStates.FAILURE]: CheckOutcomes.FAILED,
  [CommitStatusStates.ERROR]: CheckOutcomes.FAILED,
};

function readRunOutcome(run: CheckRun): CheckOutcome {
  if (!run.completed) {
    return CheckOutcomes.RUNNING;
  }
  const passed =
    run.conclusion !== undefined && PASSING_CONCLUSIONS.has(run.conclusion);
  return passed ? CheckOutcomes.PASSED : CheckOutcomes.FAILED;
}

function listLatestOutcomes(
  reports: HeadReports,
  name: string,
): CheckOutcome[] {
  const outcomes: CheckOutcome[] = [];
  const run = findLatestRun(
    reports.checkRuns,
    (listed) => listed.name === name,
  );
  if (run !== undefined) {
    outcomes.push(readRunOutcome(run));
  }
  const status = reports.statuses.find((listed) => listed.context === name);
  if (status !== undefined) {
    outcomes.push(STATUS_OUTCOMES[status.state]);
  }
  return outcomes;
}

function isBotStatus(status: CommitStatus, name: string): boolean {
  return (
    status.context === name && status.creatorType === GitHubAccountTypes.BOT
  );
}

/**
 * A pin names the App that must provide the check, by a run or a status. A
 * run is told by its App, and once the App has one under the name, it alone
 * counts, as GitHub counts it, so no refused status read can change it.
 */
function findPinnedRun(
  reports: HeadReports,
  check: RequiredStatusCheck,
): CheckRun | undefined {
  if (check.appId === undefined) {
    return undefined;
  }
  const appRuns = reports.checkRuns.filter((run) => run.appId === check.appId);
  return findLatestRun(appRuns, (listed) => listed.name === check.context);
}

/**
 * A status shows only that an App's bot posted it, so with no pinned run the
 * latest bot status counts, and another App's bot posting the name passes
 * too. A user's status never counts.
 */
function listPinnedStatusOutcomes(
  reports: HeadReports,
  name: string,
): CheckOutcome[] {
  const status = reports.statuses.find((listed) => isBotStatus(listed, name));
  if (status === undefined) {
    return [];
  }
  return [STATUS_OUTCOMES[status.state]];
}

/** Any check, pinned or not, may report through either source. */
function isReadRefused(reports: HeadReports): boolean {
  return reports.checkRunsForbidden || reports.statusesForbidden;
}

function combineOutcomes(outcomes: readonly CheckOutcome[]): CheckOutcome {
  if (outcomes.length === 0) {
    return CheckOutcomes.MISSING;
  }
  if (outcomes.includes(CheckOutcomes.FAILED)) {
    return CheckOutcomes.FAILED;
  }
  if (outcomes.includes(CheckOutcomes.RUNNING)) {
    return CheckOutcomes.RUNNING;
  }
  return CheckOutcomes.PASSED;
}

/** A failed or running outcome holds whatever a refused read would add. */
const OUTCOMES_A_REFUSAL_DECIDES: ReadonlySet<CheckOutcome> = new Set([
  CheckOutcomes.PASSED,
  CheckOutcomes.MISSING,
]);

/**
 * GitHub's merge rule per name: the latest run and the latest status count,
 * neutral and skipped pass. A name both kinds report passes only when both
 * do, so a pass or nothing read while one source was refused is decided by
 * the refusal: missing, unless the pinned App's run decided it.
 */
function readCheckReading(
  reports: HeadReports,
  check: RequiredStatusCheck,
): CheckReading {
  const pinnedRun = findPinnedRun(reports, check);
  if (pinnedRun !== undefined) {
    return { outcome: readRunOutcome(pinnedRun), decidedByRefusal: false };
  }

  const outcomes =
    check.appId === undefined
      ? listLatestOutcomes(reports, check.context)
      : listPinnedStatusOutcomes(reports, check.context);
  const outcome = combineOutcomes(outcomes);
  const decidedByRefusal =
    isReadRefused(reports) && OUTCOMES_A_REFUSAL_DECIDES.has(outcome);
  if (decidedByRefusal) {
    return { outcome: CheckOutcomes.MISSING, decidedByRefusal };
  }
  return { outcome, decidedByRefusal };
}

function listNamedChecks(names: readonly string[]): RequiredStatusCheck[] {
  return names.map((context) => ({ context }));
}

/** A missing check needs someone to start it; a running one only time. */
const OUTCOME_SEVERITY: Readonly<Record<CheckOutcome, number>> = {
  [CheckOutcomes.PASSED]: 0,
  [CheckOutcomes.RUNNING]: 1,
  [CheckOutcomes.MISSING]: 2,
  [CheckOutcomes.FAILED]: 3,
};

/**
 * Each name's worst reading, in first-listed order: two rulesets may pin one
 * name to different Apps, and the name must pass under both.
 */
function readNameReadings(
  reports: HeadReports,
  checks: readonly RequiredStatusCheck[],
): Map<string, CheckReading> {
  const readings = new Map<string, CheckReading>();
  for (const check of checks) {
    const reading = readCheckReading(reports, check);
    const known = readings.get(check.context);
    const isWorse =
      known === undefined ||
      OUTCOME_SEVERITY[reading.outcome] > OUTCOME_SEVERITY[known.outcome];
    if (isWorse) {
      readings.set(check.context, reading);
    }
  }
  return readings;
}

/** `required` reads the base branch's rulesets; an empty set passes. */
export function checkCi({
  value,
  setBy,
  facts,
}: KindCheckInput<typeof TriggerConditionKinds.CI>): UnmetPlainCondition[] {
  const { reports } = facts;
  const checks =
    value.mode === CiModes.REQUIRED
      ? reports.requiredChecks
      : listNamedChecks(value.checks);
  const failed: string[] = [];
  const running: string[] = [];
  const missing: string[] = [];
  const lists: Readonly<Record<CheckOutcome, string[] | undefined>> = {
    [CheckOutcomes.PASSED]: undefined,
    [CheckOutcomes.FAILED]: failed,
    [CheckOutcomes.RUNNING]: running,
    [CheckOutcomes.MISSING]: missing,
  };
  let permissionMissing = false;
  for (const [name, reading] of readNameReadings(reports, checks)) {
    lists[reading.outcome]?.push(name);
    permissionMissing ||= reading.decidedByRefusal;
  }

  const unmetCount = failed.length + running.length + missing.length;
  if (unmetCount === 0) {
    return [];
  }
  return [
    {
      kind: TriggerConditionKinds.CI,
      setBy,
      failed,
      running,
      missing,
      permissionMissing,
    },
  ];
}
