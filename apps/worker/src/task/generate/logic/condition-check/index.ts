import { resolveEffectiveTriggerConditions } from "generators/trigger-conditions";
import { GenerationStatuses } from "types/generations";
import {
  acquireRepoConfig,
  type AcquiredRepoConfig,
} from "../../../repo-config";
import {
  ConditionCheckKinds,
  type ConditionCheckOutcome,
  type RunContext,
} from "../../types";
import { throwOnRetryableSettingsRead } from "../author-gate";
import { evaluateTriggerConditions } from "./evaluate";
import type { ConditionFacts } from "./types";

const HELD: ConditionCheckOutcome = { kind: ConditionCheckKinds.HELD };

function proceed(
  repoConfig: AcquiredRepoConfig | undefined,
): ConditionCheckOutcome {
  return { kind: ConditionCheckKinds.PROCEED, repoConfig };
}

/**
 * A url-box job is the viewer's own paste, a recovery run or a stored
 * brief's run already passed, a succeeded row has nothing to hold, and a
 * Generate click stamped its head to skip the conditions.
 */
function isCheckable(context: RunContext): boolean {
  const { payload, recovering, existingBrief, projected } = context;
  const stamped =
    projected !== undefined && projected.generateRequestedAt !== null;
  const checkable =
    payload.grantId === undefined &&
    !recovering &&
    existingBrief === undefined &&
    projected?.status !== GenerationStatuses.SUCCEEDED &&
    !stamped;
  return checkable;
}

function readConditionFacts(context: RunContext): ConditionFacts {
  return { draft: context.prInfo.draft };
}

/**
 * Whether the run may go on to its claim. The instance's and the default
 * branch's conditions merge per kind; a repo settings read a retry may
 * clear retries while attempts remain, and a refused or last read applies
 * the instance's alone. An unmet condition holds the row and ends the run:
 * no claim, no attempt, no model. A hold the store refuses (a Generate
 * click, a live claim, a kept status) stands the run down the same way;
 * the click's own job runs the head.
 */
export async function applyConditionCheck(
  context: RunContext,
  gateRepoConfig: AcquiredRepoConfig | undefined,
): Promise<ConditionCheckOutcome> {
  if (!isCheckable(context)) {
    return proceed(gateRepoConfig);
  }

  const { deps, source, log, projection, target } = context;
  const repoConfig = gateRepoConfig ?? (await acquireRepoConfig(source, log));
  throwOnRetryableSettingsRead(context, repoConfig);
  const effective = resolveEffectiveTriggerConditions(
    deps.triggerConditions,
    repoConfig.settings?.triggerConditions,
  );
  const unmet = evaluateTriggerConditions(
    effective,
    readConditionFacts(context),
  );
  if (unmet.length === 0) {
    return proceed(repoConfig);
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
  return HELD;
}
