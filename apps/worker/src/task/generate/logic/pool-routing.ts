import { CallPlanKinds, predictCallPlan } from "brief-core";
import { createIngestRoutines, type RouteToLargePoolInput } from "persistence";
import type { Mutable } from "types/utils";
import { RunPools, type RunContext } from "../types";

/**
 * Whether this run moves to the large pool before its claim: a normal-pool
 * run, over no stored brief, whose counts predict multi-call.
 */
export function isBoundForLargePool(context: RunContext): boolean {
  const { pool, existingBrief, prInfo } = context;
  if (pool === RunPools.LARGE || existingBrief !== undefined) {
    return false;
  }
  return predictCallPlan(prInfo) === CallPlanKinds.MULTI;
}

/**
 * Decide the run's pool before its claim, from the PR read already made. A
 * normal-pool run the counts predict multi-call moves its job to the large
 * pool and ends here with nothing claimed, recorded or marked; the large
 * pool's run never moves, and a wrong guess runs where it landed. A run over
 * the pair's stored brief reaches no model for the brief, so it stays. True
 * when this run ends here.
 */
export async function routeRunToLargePool(
  context: RunContext,
): Promise<boolean> {
  const { prInfo, deps, payload, recovering, log } = context;
  if (!isBoundForLargePool(context)) {
    return false;
  }

  const request: Mutable<RouteToLargePoolInput> = {
    pullRequestId: payload.pullRequestId,
    headSha: payload.headSha,
    recovering,
  };
  if (payload.grantId !== undefined) {
    request.grantId = payload.grantId;
  }
  const ingest = createIngestRoutines(deps.handle, payload.ctx);
  const routed = await ingest.routeToLargePool(request);

  const message = routed.queued
    ? "generate: predicted multi-call, the job moves to the large pool"
    : "generate: predicted multi-call, a queued job already follows";
  log.info(message, {
    changedFiles: prInfo.changedFiles,
    changedLines: prInfo.additions + prInfo.deletions,
  });
  return true;
}
