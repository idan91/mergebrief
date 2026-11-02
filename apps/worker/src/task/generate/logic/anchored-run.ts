// The anchored-generation inputs: what the previous brief can carry across a
// push, and the hop that records where its coordinates moved. brief-core plans
// the carry; this module hands it the span and owns its one side effect.
import type { AnchorPlan, Brief, PreviousBriefInput } from "brief-core";
import type { PrSpan } from "brief-core/pr-span";
import type { Logger } from "logging";
import {
  InvalidArtifactBodyError,
  ScopeViolationError,
  type ArtifactStore,
  type BriefSpanRow,
} from "persistence";
import { TransientJobError } from "../../failure";
import type { ParsedGeneratePayload } from "../../payload";

export interface AnchoredRunInputs {
  readonly store: ArtifactStore;
  readonly prevBrief: BriefSpanRow;
  /** The previous brief's recovered body. */
  readonly previousBrief: Brief;
  readonly chainGroupIds: readonly string[];
  /** The PR's own change since the previous brief; absent when it could not be read. */
  readonly span: PrSpan | undefined;
  readonly log: Logger;
}

/**
 * The previous brief plus the span the plan reads. The plan's hop lands
 * BEFORE the model call, like comparison marks: a failed generation still
 * leaves the coordinates a later session needs. Coordinates only, so no
 * snapshot gate.
 */
export function buildPreviousBriefInput(
  payload: ParsedGeneratePayload,
  inputs: AnchoredRunInputs,
): PreviousBriefInput {
  const { store, prevBrief, previousBrief, chainGroupIds, span, log } = inputs;
  const { pullRequestId, headSha } = payload;

  async function writeHop(plan: AnchorPlan): Promise<void> {
    log.info(
      `generate: anchored generation — ${plan.frozen.length} frozen, ${plan.reLook.length} re-look group(s)`,
    );
    if (plan.hunkSpans === undefined) {
      return;
    }

    // A database throw is transient, so graphile retries it. A scope miss or
    // an invalid body keeps its class and ends the job for good.
    await store.hunkSpans
      .write({
        pullRequestId,
        baselineSha: prevBrief.headSha,
        headSha,
        spans: plan.hunkSpans,
      })
      .catch((error: unknown) => {
        if (
          error instanceof ScopeViolationError ||
          error instanceof InvalidArtifactBodyError
        ) {
          throw error;
        }
        throw new TransientJobError("hunk-span hop write failed", {
          cause: error,
        });
      });
  }

  return {
    brief: previousBrief,
    span,
    chainGroupIds,
    onPlan: writeHop,
  };
}
