import {
  buildComparisonMarks,
  categorizeDelta,
  countChangedLines,
  DeltaSkipReasons,
  exceedsDeltaCallLimits,
  isHugeSpan,
  shapeDeltaSkipped,
  shapeDeltaUnchanged,
  type DeltaInput,
  type DeltaSpanRef,
} from "brief-core";
import {
  checkDeltaForWrite,
  STORED_BODY_VERSION,
  type StoredDelta,
} from "brief-core/artifact";
import { PrSpanFailureKinds } from "brief-core/pr-span";
import type { DeltaBrief, DeltaSkipReason } from "brief-core/types";
import { GenerationKinds } from "persistence";
import type { ParsedGeneratePayload } from "../../payload";
import type {
  CheckpointDeltasInputs,
  GenerationOrigin,
  PrefetchedSpan,
} from "../types";
import { getGenerationOrigin } from "../utils";
import { warnOnFailedCheck } from "./artifact-check";
import { isOutputCut, runGenerator } from "./errors";
import { readLockfileSummaries } from "./lockfile-summaries";
import { resolveSpanBaseline } from "./revision-span";

/**
 * Prewarm each distinct checkpoint: skip stored cores, write mechanical marks, then the
 * size checks before model spend. A span too large for its delta stores a skip record.
 * A failed span aborts with its classification; stored earlier spans survive for retry.
 */
export async function generateCheckpointDeltas(
  payload: ParsedGeneratePayload,
  inputs: CheckpointDeltasInputs,
): Promise<number> {
  const { repo } = inputs;
  const { pullRequestId, headSha } = payload;

  const checkpoints = await repo.checkpoints.listForPullRequest(pullRequestId);
  const distinctShas = [
    ...new Set(checkpoints.map((checkpoint) => checkpoint.lastSubmittedSha)),
  ].filter((sha) => sha !== headSha);

  let generated = 0;
  for (const baselineSha of distinctShas) {
    // oxlint-disable-next-line no-await-in-loop -- spans run sequentially by design (one model call at a time)
    const wroteDelta = await warmCheckpointSpan(payload, inputs, baselineSha);
    if (wroteDelta) {
      generated += 1;
    }
  }
  return generated;
}

/** True when the span got a generated Delta Brief this run. */
async function warmCheckpointSpan(
  payload: ParsedGeneratePayload,
  inputs: CheckpointDeltasInputs,
  baselineSha: string,
): Promise<boolean> {
  const { store, locator, meta, priorBriefs } = inputs;
  const { pullRequestId, headSha } = payload;
  const already = await store.deltas.get(pullRequestId, baselineSha, headSha);
  if (already !== undefined) {
    return false;
  }

  const span = await readCheckpointSpan(inputs, baselineSha);
  const baselineIndex =
    priorBriefs.find((row) => row.headSha === baselineSha)?.headIndex ?? null;
  const spanRef: DeltaSpanRef = {
    locator,
    meta,
    baselineSha,
    headSha,
    baselineIndex,
    headIndex: inputs.briefHeadIndex,
  };
  if ("unread" in span) {
    // A span GitHub will not render has no marks; the record says why.
    if (span.diffTooLarge) {
      await writeDeltaSkip(
        payload,
        inputs,
        spanRef,
        DeltaSkipReasons.SPAN_TOO_LARGE,
      );
    }
    return false;
  }

  const { filteredDiff, isUnchanged } = span.span;
  if (!span.marksWritten) {
    // Span marks BEFORE the LLM call: a failed delta still leaves
    // highlights for the checkpoint span.
    await writeCheckpointMarks(payload, inputs, spanRef, filteredDiff);
  }
  if (isUnchanged) {
    await writeDeltaUnchanged(payload, inputs, spanRef);
    return false;
  }
  const spanInput: DeltaInput = { ...spanRef, incrementalDiff: filteredDiff };
  return writeSpanDelta(payload, inputs, spanInput);
}

/** No Delta Brief is owed where the PR's own change did not move: no charge, no call. */
async function writeDeltaUnchanged(
  payload: ParsedGeneratePayload,
  inputs: CheckpointDeltasInputs,
  spanRef: DeltaSpanRef,
): Promise<void> {
  const origin = await inputs.loadBriefOrigin();
  await writeDeltaRecord(payload, inputs, shapeDeltaUnchanged(spanRef), origin);
  inputs.log.info(
    "generate: checkpoint span unchanged; wrote the no-change record",
  );
}

async function writeCheckpointMarks(
  payload: ParsedGeneratePayload,
  inputs: CheckpointDeltasInputs,
  spanRef: DeltaSpanRef,
  spanDiff: string,
): Promise<void> {
  const marks = buildComparisonMarks(
    spanRef.headSha,
    spanRef.baselineSha,
    "checkpoint",
    spanRef.baselineIndex ?? null,
    spanDiff,
  );
  await inputs.store.comparisonMarks.write({
    pullRequestId: payload.pullRequestId,
    marks: {
      baselineSha: marks.baselineSha,
      headSha: marks.headSha,
      files: marks.files,
    },
  });
}

/**
 * The span, reused when the revision step already read the same span this
 * run: never read it twice, never ask again for one GitHub refused. A span
 * that cannot be read for good must not sink the job: the brief is stored.
 */
async function readCheckpointSpan(
  inputs: CheckpointDeltasInputs,
  baselineSha: string,
): Promise<PrefetchedSpan> {
  const { prevSpan, priorBriefs, baseSha, log } = inputs;
  if (prevSpan?.baselineSha === baselineSha) {
    return prevSpan;
  }

  const baseline = resolveSpanBaseline(priorBriefs, baselineSha, baseSha);
  const read = await inputs.readSpan(baseline);
  if (read.ok) {
    return { baselineSha, span: read.value, marksWritten: false };
  }
  const diffTooLarge = read.error.kind === PrSpanFailureKinds.TOO_LARGE;
  if (!diffTooLarge) {
    log.warn("generate: delta span unavailable; skipping");
  }
  return { baselineSha, unread: true, diffTooLarge };
}

/** Both size checks run before the supersession gate and the spend charge. */
async function writeSpanDelta(
  payload: ParsedGeneratePayload,
  inputs: CheckpointDeltasInputs,
  spanInput: DeltaInput,
): Promise<boolean> {
  const { SPAN_TOO_LARGE, OUTPUT_CUT } = DeltaSkipReasons;
  const ratioHuge = isHugeSpan(
    countChangedLines(spanInput.incrementalDiff),
    inputs.wholePrChangedLines,
    inputs.hugeSpanRatio,
  );
  if (ratioHuge) {
    await writeDeltaSkip(payload, inputs, spanInput, SPAN_TOO_LARGE);
    return false;
  }

  const { links, primaryTicket } = await inputs.loadContext();
  const promptInput: DeltaInput = { ...spanInput, links, primaryTicket };
  if (exceedsDeltaCallLimits(promptInput)) {
    await writeDeltaSkip(payload, inputs, spanInput, SPAN_TOO_LARGE);
    return false;
  }

  // The summaries feed the package-source rule, never the prompt, so a
  // skipped span reads none.
  const lockfileSummaries = await readLockfileSummaries(
    inputs.source,
    spanInput.incrementalDiff,
    { base: spanInput.baselineSha, head: spanInput.headSha },
    inputs.log,
    inputs.stops,
  );
  const deltaInput: DeltaInput = { ...promptInput, lockfileSummaries };

  await inputs.watch.assertCurrent();
  await inputs.chargeSpend();
  const delta = await runDeltaCall(deltaInput, inputs);
  if (delta === undefined) {
    await writeDeltaSkip(payload, inputs, spanInput, OUTPUT_CUT);
    return false;
  }

  const origin = getGenerationOrigin(delta.generation);
  await writeDeltaRecord(payload, inputs, delta, origin);
  return true;
}

/** The generated Delta Brief, or undefined when its output hit the cap. */
async function runDeltaCall(
  deltaInput: DeltaInput,
  inputs: CheckpointDeltasInputs,
): Promise<DeltaBrief | undefined> {
  const { generator, effort, log } = inputs;
  try {
    return await runGenerator(
      () =>
        categorizeDelta(
          deltaInput,
          generator,
          (message) => log.info(message),
          effort,
        ),
      log,
      GenerationKinds.DELTA,
      { outputCutIsSkip: true },
    );
  } catch (error) {
    if (isOutputCut(error)) {
      return undefined;
    }
    throw error;
  }
}

async function writeDeltaSkip(
  payload: ParsedGeneratePayload,
  inputs: CheckpointDeltasInputs,
  spanRef: DeltaSpanRef,
  reason: DeltaSkipReason,
): Promise<void> {
  const origin = await inputs.loadBriefOrigin();
  const record = shapeDeltaSkipped(spanRef, reason);
  await writeDeltaRecord(payload, inputs, record, origin);

  const fields = { reason };
  const message = "generate: checkpoint span too large for a delta";
  if (reason === DeltaSkipReasons.OUTPUT_CUT) {
    inputs.log.warn(`${message}: output cut at its cap`, fields);
    return;
  }
  inputs.log.info(message, fields);
}

async function writeDeltaRecord(
  payload: ParsedGeneratePayload,
  inputs: CheckpointDeltasInputs,
  body: StoredDelta,
  origin: GenerationOrigin,
): Promise<void> {
  const deltaCheck = checkDeltaForWrite(body);
  warnOnFailedCheck(deltaCheck, GenerationKinds.DELTA, inputs.log);

  await inputs.store.deltas.write({
    pullRequestId: payload.pullRequestId,
    baselineSha: body.baselineSha,
    headSha: body.headSha,
    ...origin,
    body: JSON.stringify(body),
    bodyVersion: STORED_BODY_VERSION,
  });
}
