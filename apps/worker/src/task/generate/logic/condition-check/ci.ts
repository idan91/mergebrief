import {
  CheckRunConclusions,
  CommitStatusStates,
  type CheckRun,
  type CommitStatusState,
} from "github";
import { CiModes } from "generators/trigger-conditions";
import {
  TriggerConditionKinds,
  type UnmetPlainCondition,
} from "types/trigger-conditions";

import {
  CheckOutcomes,
  type CheckOutcome,
  type HeadReports,
  type KindCheckInput,
} from "./types";

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

/** A rerun takes a higher id, so the highest is the run GitHub counts. */
function findLatestRun(
  runs: readonly CheckRun[],
  name: string,
): CheckRun | undefined {
  const named = runs.filter((run) => run.name === name);
  return named.reduce<CheckRun | undefined>((latest, run) => {
    if (latest === undefined || run.checkRunId > latest.checkRunId) {
      return run;
    }
    return latest;
  }, undefined);
}

function listLatestOutcomes(
  reports: HeadReports,
  name: string,
): CheckOutcome[] {
  const outcomes: CheckOutcome[] = [];
  const run = findLatestRun(reports.checkRuns, name);
  if (run !== undefined) {
    outcomes.push(readRunOutcome(run));
  }
  const status = reports.statuses.find((listed) => listed.context === name);
  if (status !== undefined) {
    outcomes.push(STATUS_OUTCOMES[status.state]);
  }
  return outcomes;
}

/**
 * GitHub's merge rule per name: the latest run and the latest status count,
 * neutral and skipped pass. A name both kinds report passes only when both do.
 */
function readCheckOutcome(reports: HeadReports, name: string): CheckOutcome {
  const outcomes = listLatestOutcomes(reports, name);
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

/** `required` reads the base branch's rulesets; an empty set passes. */
export function checkCi({
  value,
  setBy,
  facts,
}: KindCheckInput<typeof TriggerConditionKinds.CI>): UnmetPlainCondition[] {
  const { reports } = facts;
  const names =
    value.mode === CiModes.REQUIRED ? reports.requiredChecks : value.checks;
  const failed: string[] = [];
  const running: string[] = [];
  const missing: string[] = [];
  const lists: Readonly<Record<CheckOutcome, string[] | undefined>> = {
    [CheckOutcomes.PASSED]: undefined,
    [CheckOutcomes.FAILED]: failed,
    [CheckOutcomes.RUNNING]: running,
    [CheckOutcomes.MISSING]: missing,
  };
  for (const name of names) {
    lists[readCheckOutcome(reports, name)]?.push(name);
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
      permissionMissing: reports.statusChecksForbidden,
    },
  ];
}
