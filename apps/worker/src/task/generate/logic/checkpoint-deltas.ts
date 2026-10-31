import {
  buildComparisonMarks,
  categorizeDelta,
  countChangedLines,
  isHugeSpan,
  type DeltaInput,
} from "brief-core";
import {
  checkDeltaBriefForWrite,
  STORED_BODY_VERSION,
} from "brief-core/artifact";
import { GenerationKinds } from "persistence";
import type { ParsedGeneratePayload } from "../../payload";
import type { CheckpointDeltasInputs } from "../types";
import { getGenerationOrigin } from "../utils";
import { warnOnFailedCheck } from "./artifact-check";
import { runGenerator } from "./errors";
import { readLockfileSummaries } from "./lockfile-summaries";
import { resolveDeltaSpanDiff } from "./revision-artifacts";

/**
 * Prewarm each distinct checkpoint: skip stored cores, write mechanical marks, then apply
 * the huge-span guard before model spend. Missing huge-span deltas signal full-brief fallback.
 * A failed span aborts with its classification; stored earlier spans survive for retry.
 */
export async function generateCheckpointDeltas(
  payload: ParsedGeneratePayload,
  inputs: CheckpointDeltasInputs,
): Promise<number> {
  const { store, repo, locator, meta, source, priorBriefs, log } = inputs;
  const { pullRequestId, headSha } = payload;

  const checkpoints = await repo.checkpoints.listForPullRequest(pullRequestId);
  const distinctShas = [
    ...new Set(checkpoints.map((checkpoint) => checkpoint.lastSubmittedSha)),
  ].filter((sha) => sha !== headSha);

  let generated = 0;
  for (const baselineSha of distinctShas) {
    // oxlint-disable-next-line no-await-in-loop -- spans run sequentially by design (one model call at a time)
    const already = await store.deltas.get(pullRequestId, baselineSha, headSha);
    if (already !== undefined) {
      continue;
    }
    // Reuse the prevHead...head diff fetched for the revision artifacts when
    // the checkpoint sits at the previous briefed head (the common
    // reviewed-last-push case), never fetch the same span twice in one run.
    const prefetched =
      inputs.prevSpan?.baselineSha === baselineSha
        ? inputs.prevSpan
        : undefined;
    if (prefetched !== undefined && "refused" in prefetched) {
      continue;
    }
    let incrementalDiff: string;
    if (prefetched !== undefined) {
      incrementalDiff = prefetched.diff;
    } else {
      // oxlint-disable-next-line no-await-in-loop
      const spanDiff = await resolveDeltaSpanDiff(
        source,
        baselineSha,
        headSha,
        log,
      );
      if (spanDiff === undefined) {
        continue;
      }
      incrementalDiff = spanDiff;
    }

    const baselineIndex =
      priorBriefs.find((row) => row.headSha === baselineSha)?.headIndex ?? null;
    if (prefetched?.marksWritten !== true) {
      // Span marks BEFORE the LLM call: a failed delta still leaves
      // highlights for the checkpoint span.
      const marks = buildComparisonMarks(
        headSha,
        baselineSha,
        "checkpoint",
        baselineIndex,
        incrementalDiff,
      );
      // oxlint-disable-next-line no-await-in-loop
      await store.comparisonMarks.write({
        pullRequestId,
        marks: {
          baselineSha: marks.baselineSha,
          headSha: marks.headSha,
          files: marks.files,
        },
      });
    }

    const deltaSpanHuge = isHugeSpan(
      countChangedLines(incrementalDiff),
      inputs.wholePrChangedLines,
      inputs.hugeSpanRatio,
    );
    if (deltaSpanHuge) {
      log.info(
        `generate: delta span ${baselineSha.slice(0, 8)} is huge — full-brief fallback`,
      );
      continue;
    }

    // oxlint-disable-next-line no-await-in-loop -- one shared load, memoized
    const { links, primaryTicket } = await inputs.loadContext();
    // oxlint-disable-next-line no-await-in-loop -- one span's lockfiles at a time
    const lockfileSummaries = await readLockfileSummaries(
      source,
      incrementalDiff,
      { base: baselineSha, head: headSha },
      log,
      inputs.stops,
    );
    const deltaInput: DeltaInput = {
      locator,
      meta,
      baselineSha,
      headSha,
      baselineIndex,
      headIndex: inputs.briefHeadIndex,
      incrementalDiff,
      links,
      primaryTicket,
      lockfileSummaries,
    };
    // Supersession gate and spend charge BEFORE each delta spend.
    // oxlint-disable-next-line no-await-in-loop
    await inputs.watch.assertCurrent();
    // oxlint-disable-next-line no-await-in-loop
    await inputs.chargeSpend();
    // oxlint-disable-next-line no-await-in-loop
    const delta = await runGenerator(
      () =>
        categorizeDelta(
          deltaInput,
          inputs.generator,
          (message) => log.info(message),
          inputs.effort,
        ),
      log,
      GenerationKinds.DELTA,
    );
    const deltaCheck = checkDeltaBriefForWrite(delta);
    warnOnFailedCheck(deltaCheck, GenerationKinds.DELTA, log);
    // oxlint-disable-next-line no-await-in-loop
    await store.deltas.write({
      pullRequestId,
      baselineSha,
      headSha,
      ...getGenerationOrigin(delta.generation),
      body: JSON.stringify(delta),
      bodyVersion: STORED_BODY_VERSION,
    });
    generated += 1;
  }
  return generated;
}
