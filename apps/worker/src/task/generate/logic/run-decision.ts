import type {
  GenerationProjection,
  GenerationRow,
  GenerationTarget,
} from "persistence";
import { GenerationStatuses } from "types/generations";
import { RunDecisionKinds, type RunContext, type RunDecision } from "../types";
import { applySpendGate, refuseAtCap } from "./spend-gate";

/**
 * Whether the run reaches a model, decided once. A run over the pair's stored
 * brief leaves the row as found and meets the cap as a ceiling only; a fresh
 * run projects itself if ingest did not, claims the row and starts under the
 * cap. `run.leaveRow` is settled here, before any provider call.
 */
export async function decideRun(context: RunContext): Promise<RunDecision> {
  const { payload, run, existingBrief } = context;
  if (existingBrief !== undefined) {
    run.leaveRow = true;
    const refused = await refuseAtCap(payload, context);
    if (refused) {
      return { kind: RunDecisionKinds.CAPPED, storedBrief: existingBrief };
    }
    return { kind: RunDecisionKinds.STORED_BRIEF, storedBrief: existingBrief };
  }

  await projectIfUnprojected(
    context.projection,
    context.target,
    context.projected,
  );
  run.leaveRow = false;
  const capped = await applySpendGate(payload, context);
  if (capped) {
    return { kind: RunDecisionKinds.CAPPED, storedBrief: undefined };
  }
  return { kind: RunDecisionKinds.FRESH };
}

/**
 * Ingest projects a run it expects; one it classified as covered by the
 * stored base, while the live base moved, arrives unprojected and projects
 * itself so the attempt counts and the wait state shows. Only a succeeded row
 * (or none) means that: a failed row is graphile retrying a transient
 * failure, and a retry keeps its status until the gate decides.
 */
async function projectIfUnprojected(
  projection: GenerationProjection,
  target: GenerationTarget,
  current: GenerationRow | undefined,
): Promise<void> {
  if (
    current !== undefined &&
    current.status !== GenerationStatuses.SUCCEEDED
  ) {
    return;
  }
  const projected = await projection.upsertPending(target);
  if (!projected.ok) {
    throw new Error(
      `generate: could not project the run: ${projected.error.code}`,
    );
  }
}
