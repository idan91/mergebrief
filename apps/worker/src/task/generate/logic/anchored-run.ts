// The anchored-generation inputs: what the previous brief can carry across a
// push, and the hop that records where its coordinates moved. brief-core plans
// the carry; this module fetches what the plan reads and owns its one side effect.
import type { AnchorPlan, Brief, PreviousBriefInput } from "brief-core";
import type { GitHubApiError } from "github";
import type { Logger } from "logging";
import type { ArtifactStore, BriefSpanRow } from "persistence";
import type { Mutable, Result } from "types/utils";
import { PermanentJobError, TransientJobError } from "../../failure";
import type { PullRequestSource } from "../../github-port";
import type { ParsedGeneratePayload } from "../../payload";

export interface AnchoredRunInputs {
  readonly store: ArtifactStore;
  readonly source: PullRequestSource;
  readonly prevBrief: BriefSpanRow;
  /** The previous brief's recovered body. */
  readonly previousBrief: Brief;
  readonly chainGroupIds: readonly string[];
  /** The prevHead...head compare diff Result, fetched once by the caller. */
  readonly prevSpanFetch: Result<string, GitHubApiError> | undefined;
  /** This run's PR base; a move since the previous brief untrusts three-dot data. */
  readonly baseSha: string;
  readonly log: Logger;
}

/**
 * The previous brief plus the span data the plan reads. The plan's hop lands
 * BEFORE the model call, like comparison marks: a failed generation still
 * leaves the coordinates a later session needs. Coordinates only, so no
 * snapshot gate.
 */
export async function buildPreviousBriefInput(
  payload: ParsedGeneratePayload,
  inputs: AnchoredRunInputs,
): Promise<PreviousBriefInput> {
  const {
    store,
    source,
    prevBrief,
    previousBrief,
    chainGroupIds,
    prevSpanFetch,
    baseSha,
    log,
  } = inputs;
  const { pullRequestId, headSha } = payload;

  const compareFilesResult = await source.fetchCompareFiles(
    prevBrief.headSha,
    headSha,
  );
  if (!compareFilesResult.ok) {
    log.warn(
      `generate: compare files fetch failed (anchoring degrades to full re-look) — ${compareFilesResult.error.message}`,
    );
  }

  async function writeHop(plan: AnchorPlan): Promise<void> {
    log.info(
      `generate: anchored generation — ${plan.frozen.length} frozen, ${plan.reLook.length} re-look group(s)`,
    );
    if (plan.hunkSpans === undefined) {
      return;
    }

    // A thrown write is the database, not the shape: transient, so graphile
    // retries it.
    const hopWritten = await store.hunkSpans
      .write({
        pullRequestId,
        baselineSha: prevBrief.headSha,
        headSha,
        spans: plan.hunkSpans,
      })
      .catch((error: unknown) => {
        throw new TransientJobError("hunk-span hop write failed", {
          cause: error,
        });
      });
    // Both failure codes are deterministic writer defects against a fixed
    // shape and a resolved parent, no retry can fix either.
    if (!hopWritten.ok) {
      throw new PermanentJobError(hopWritten.error.message);
    }
  }

  const previous: Mutable<PreviousBriefInput> = {
    brief: previousBrief,
    chainGroupIds,
    baseShaMoved: prevBrief.baseSha !== baseSha,
    onPlan: writeHop,
  };
  if (prevSpanFetch?.ok === true) {
    previous.incrementalDiff = prevSpanFetch.value;
  }
  if (compareFilesResult.ok) {
    previous.compareFiles = compareFilesResult.value;
  }

  return previous;
}
