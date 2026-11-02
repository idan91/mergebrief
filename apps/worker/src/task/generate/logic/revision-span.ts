import { PrSpanFailureKinds, readPrSpan } from "brief-core/pr-span";
import type { BriefSpanRow } from "persistence";
import { GenerationFailureCodes } from "types/generations";
import { TransientJobError } from "../../failure";
import type { RevisionSpanReader, RunContext, SpanBaseline } from "../types";
import { isFinalRunAttempt } from "../utils";
import { buildWorkerPrSpanSource, type CountedPrDiff } from "./span-source";
import { listRunStops } from "./step-span";

/** GitHub's file count describes the PR's head as read, so it checks the job's head only when they match. */
function readCountedPrDiff(context: RunContext): CountedPrDiff | undefined {
  const { prInfo, payload } = context;
  if (prInfo.headSha !== payload.headSha) {
    return undefined;
  }
  return {
    base: prInfo.baseSha,
    head: payload.headSha,
    fileCount: prInfo.changedFiles,
  };
}

/**
 * The span reader over the run's GitHub source, stopped by the run's stops.
 * A transient failure throws for the retry; on the run's final attempt the
 * span reads unavailable instead, so the run writes nothing for it and its
 * caller warns once.
 */
export function createRevisionSpanReader(
  context: RunContext,
): RevisionSpanReader {
  const { source, prInfo, payload } = context;
  const spanSource = buildWorkerPrSpanSource(
    source,
    readCountedPrDiff(context),
  );
  const stops = listRunStops(context).filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  const signal = AbortSignal.any(stops);

  return async (baseline) => {
    const refs = {
      prevBase: baseline.baseSha,
      prevHead: baseline.headSha,
      newBase: prInfo.baseSha,
      newHead: payload.headSha,
    };
    const read = await readPrSpan(spanSource, refs, signal);
    if (read.ok || read.error.kind !== PrSpanFailureKinds.TRANSIENT) {
      return read;
    }

    if (!isFinalRunAttempt(context)) {
      throw new TransientJobError("generate: revision span read failed", {
        failure: { code: GenerationFailureCodes.GITHUB_UNAVAILABLE },
      });
    }
    return { ok: false, error: { kind: PrSpanFailureKinds.UNAVAILABLE } };
  };
}

/**
 * The base a checkpoint's span starts from: the newest Brief written at that
 * head, the same row order the previous Brief is picked by, else the PR's
 * current base.
 */
export function resolveSpanBaseline(
  priorBriefs: readonly BriefSpanRow[],
  headSha: string,
  currentBase: string,
): SpanBaseline {
  const brief = priorBriefs.findLast((row) => row.headSha === headSha);
  return { headSha, baseSha: brief?.baseSha ?? currentBase };
}
