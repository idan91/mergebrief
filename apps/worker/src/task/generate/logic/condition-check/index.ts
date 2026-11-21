import { resolveEffectiveTriggerConditions } from "generators/trigger-conditions";
import type { AcquiredRepoConfig } from "../../../repo-config";
import {
  ConditionCheckKinds,
  type ConditionCheckOutcome,
  type RunContext,
} from "../../types";
import { acquireGateRepoConfig, isGateable } from "../run-gates";
import { evaluateTriggerConditions } from "./evaluate";
import type { ConditionFacts } from "./types";

const HELD: ConditionCheckOutcome = { kind: ConditionCheckKinds.HELD };

function buildProceedOutcome(
  repoConfig: AcquiredRepoConfig | undefined,
): ConditionCheckOutcome {
  return { kind: ConditionCheckKinds.PROCEED, repoConfig };
}

/** A gateable run, unless a Generate click stamped its head to skip the conditions. */
function isCheckable(context: RunContext): boolean {
  const { projected } = context;
  const stamped =
    projected !== undefined && projected.generateRequestedAt !== null;
  const checkable = isGateable(context) && !stamped;
  return checkable;
}

function readConditionFacts(context: RunContext): ConditionFacts {
  return { draft: context.prInfo.draft };
}

/**
 * Whether the run may go on to its claim. The instance's and the default
 * branch's conditions merge per kind; a repo settings read a retry may
 * clear is tried again in the run, and a refused or last read applies the
 * instance's alone. An unmet condition holds the row and ends the run:
 * no claim, no attempt, no model. A hold the store refuses (a Generate
 * click, a live claim, a kept status) stands the run down the same way;
 * the click's own job runs the head.
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
  const unmet = evaluateTriggerConditions(
    effective,
    readConditionFacts(context),
  );
  if (unmet.length === 0) {
    return buildProceedOutcome(repoConfig);
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
