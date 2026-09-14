// The anchored-generation decision: what the previous brief can carry across a
// push, and the hop that records where its coordinates moved. The task keeps
// the orchestration; this module owns the decision and its one side effect.
import {
  planAnchoredGeneration,
  type AnchorPlan,
  type AnchorPlanArgs,
  type AnchorViewInput,
  type Brief,
} from "brief-core";
import type { GitHubApiError } from "github";
import type { Logger } from "logging";
import type { ArtifactStore, BriefSpanRow } from "persistence";
import type { Mutable, Result } from "types/utils";
import { PermanentJobError } from "../../failure";
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

export interface AnchoredRun {
  readonly plan: AnchorPlan;
  /** The prompt contract: the trimmed previous brief plus the mechanical frozen partition. */
  readonly view: AnchorViewInput;
}

/**
 * Partition the previous brief into frozen and re-look groups. The hop lands
 * BEFORE the model call, like comparison marks: a failed generation still
 * leaves the coordinates a later session needs. Coordinates only, so no
 * snapshot gate.
 */
export async function planAnchoredRun(
  payload: ParsedGeneratePayload,
  inputs: AnchoredRunInputs,
): Promise<AnchoredRun> {
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

  const planArgs: Mutable<AnchorPlanArgs> = {
    previousBrief,
    chainGroupIds,
    baseShaMoved: prevBrief.baseSha !== baseSha,
  };
  if (prevSpanFetch?.ok === true) {
    planArgs.incrementalDiff = prevSpanFetch.value;
  }
  if (compareFilesResult.ok) {
    planArgs.compareFiles = compareFilesResult.value;
  }

  const plan = planAnchoredGeneration(planArgs);
  log.info(
    `generate: anchored generation — ${plan.frozen.length} frozen, ${plan.reLook.length} re-look group(s)`,
  );

  if (plan.hunkSpans !== undefined) {
    const hopWritten = await store.hunkSpans.write({
      pullRequestId,
      baselineSha: prevBrief.headSha,
      headSha,
      spans: plan.hunkSpans,
    });
    // Both failure codes are deterministic writer defects against a fixed
    // shape and a resolved parent, no retry can fix either.
    if (!hopWritten.ok) {
      throw new PermanentJobError(hopWritten.error.message);
    }
  }

  return {
    plan,
    view: {
      previousBrief,
      frozenGroupIds: plan.frozen.map((carry) => carry.group.id),
    },
  };
}
