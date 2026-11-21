import type { PullRequestFile } from "github";
import { SizeMeasures } from "types/trigger-conditions";
import {
  resolveEffectiveTriggerConditions,
  type EffectiveTriggerConditions,
} from "generators/trigger-conditions";
import type { Mutable } from "types/utils";
import type { AcquiredRepoConfig } from "../../../repo-config";
import {
  ConditionCheckKinds,
  type ConditionCheckOutcome,
  type RunContext,
} from "../../types";
import { throwOnGitHubFailure } from "../errors";
import { acquireGateRepoConfig, isGateable } from "../run-gates";
import { evaluateTriggerConditions, isVerdictOnPaths } from "./evaluate";
import { postHeldEntry } from "./held-entry";
import type { ConditionFacts } from "./types";

const HELD: ConditionCheckOutcome = { kind: ConditionCheckKinds.HELD };

function buildProceedOutcome(
  repoConfig: AcquiredRepoConfig | undefined,
  files?: readonly PullRequestFile[],
): ConditionCheckOutcome {
  return { kind: ConditionCheckKinds.PROCEED, repoConfig, files };
}

/** A gateable run, unless a Generate click stamped its head to skip the conditions. */
function isCheckable(context: RunContext): boolean {
  const { projected } = context;
  const stamped =
    projected !== undefined && projected.generateRequestedAt !== null;
  const checkable = isGateable(context) && !stamped;
  return checkable;
}

/**
 * Only a `paths` condition that can decide the verdict reads the file list
 * this early. A failure classifies as the run's own later read would: a
 * transient one retries before any hold, so no head is held on a list it
 * never saw.
 */
async function readCheckedFiles(
  context: RunContext,
  effective: EffectiveTriggerConditions,
  facts: ConditionFacts,
): Promise<readonly PullRequestFile[] | undefined> {
  if (!isVerdictOnPaths(effective, facts)) {
    return undefined;
  }
  return throwOnGitHubFailure(await context.source.fetchPullRequestFiles());
}

function readConditionFacts(
  context: RunContext,
  files: readonly PullRequestFile[] | undefined,
): ConditionFacts {
  const { prInfo } = context;
  const changedLines = prInfo.additions + prInfo.deletions;
  const facts: Mutable<ConditionFacts> = {
    draft: prInfo.draft,
    title: prInfo.title,
    labels: prInfo.labels,
    pendingReviewRequests: prInfo.pendingReviewRequests,
    sizes: {
      [SizeMeasures.CHANGED_LINES]: changedLines,
      [SizeMeasures.ADDITIONS]: prInfo.additions,
      [SizeMeasures.DELETIONS]: prInfo.deletions,
    },
    changedPaths: files?.map((file) => file.path),
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
 * the click's own job runs the head. A held head gets the held Entry.
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
  const unreadFacts = readConditionFacts(context, undefined);
  const files = await readCheckedFiles(context, effective, unreadFacts);
  const unmet = evaluateTriggerConditions(
    effective,
    readConditionFacts(context, files),
  );
  if (unmet.length === 0) {
    return buildProceedOutcome(repoConfig, files);
  }

  const held = await projection.markHeld(target, unmet);
  if (!held.ok) {
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
