import type { Result } from "types/utils";
import { MAX_SPAN_CHANGED_FILES } from "./consts";
import { pickLastingFailure } from "./logic/lasting-failure";
import { SpanRunnerError } from "./logic/line-diff";
import { confirmBaseRenames, readBetweenHeadsFiles } from "./logic/read-blobs";
import { IN_PROCESS_SPAN_RUNNER } from "./logic/span-runner";
import {
  PrSpanFailureKinds,
  type PrSpanFailure,
  type PrSpanRefs,
  type PrSpanResult,
  type PrSpanRunner,
  type PrSpanSource,
} from "./types";

function pickRoundFailure(
  reads: readonly Result<unknown, PrSpanFailure>[],
): PrSpanFailure {
  const failures = reads.flatMap((read) => (read.ok ? [] : [read.error]));
  return failures.reduce(pickLastingFailure);
}

/**
 * The runner step's answer. A `SpanRunnerError` is infrastructure, so the
 * span reads transient; an aborted read throws the signal's reason, and any
 * other throw is a bug that propagates.
 */
async function runSpanStep<Answer>(
  step: Promise<Answer>,
  signal: AbortSignal,
): Promise<Result<Answer, PrSpanFailure>> {
  try {
    return { ok: true, value: await step };
  } catch (error) {
    signal.throwIfAborted();
    if (!(error instanceof SpanRunnerError)) {
      throw error;
    }
    return { ok: false, error: { kind: PrSpanFailureKinds.TRANSIENT } };
  }
}

async function readFastForwardSpan(
  source: PrSpanSource,
  refs: PrSpanRefs,
  newPrDiff: string,
  signal: AbortSignal,
  runner: PrSpanRunner,
): Promise<PrSpanResult> {
  const betweenHeads = await source.fetchPrDiff(
    { base: refs.prevHead, head: refs.newHead },
    signal,
  );
  if (!betweenHeads.ok) {
    return betweenHeads;
  }

  const input = { betweenHeadsDiff: betweenHeads.value, newPrDiff };
  const span = await runSpanStep(
    runner.buildFastForwardSpan(input, signal),
    signal,
  );
  if (span.ok && span.value.changedFiles.length > MAX_SPAN_CHANGED_FILES) {
    return { ok: false, error: { kind: PrSpanFailureKinds.TOO_LARGE } };
  }
  return span;
}

async function readBuiltSpan(
  source: PrSpanSource,
  refs: PrSpanRefs,
  newPrDiff: string,
  signal: AbortSignal,
  runner: PrSpanRunner,
): Promise<PrSpanResult> {
  const prevPrDiff = await source.fetchPrDiff(
    { base: refs.prevBase, head: refs.prevHead },
    signal,
  );
  if (!prevPrDiff.ok) {
    return prevPrDiff;
  }

  const prDiffs = { prevPrDiff: prevPrDiff.value, newPrDiff };
  const plan = await runSpanStep(runner.planBuiltSpan(prDiffs, signal), signal);
  if (!plan.ok) {
    return plan;
  }
  const { changedCount, lineDiffFiles, baseRenameCandidates } = plan.value;
  if (changedCount > MAX_SPAN_CHANGED_FILES) {
    return { ok: false, error: { kind: PrSpanFailureKinds.TOO_LARGE } };
  }

  const confirmed = await confirmBaseRenames(
    source,
    refs,
    baseRenameCandidates,
    signal,
  );
  if (!confirmed.ok) {
    return confirmed;
  }
  const refusedFiles = baseRenameCandidates
    .filter((candidate) => !confirmed.value.has(candidate.path))
    .flatMap((candidate) => candidate.refusedLineDiffFiles);
  const betweenHeads = await readBetweenHeadsFiles(
    source,
    refs,
    [...lineDiffFiles, ...refusedFiles],
    signal,
    runner.runLineDiff,
  );
  if (!betweenHeads.ok) {
    return betweenHeads;
  }

  const input = {
    ...prDiffs,
    baseRenames: confirmed.value,
    betweenHeads: betweenHeads.value,
  };
  return runSpanStep(runner.buildPrSpan(input, signal), signal);
}

/**
 * Read the revision span through `source`. A fast-forward over an unmoved
 * merge base is the between-heads compare as served; anything else is built
 * from both heads' PR diffs, base-rename probes and both blobs of each file
 * only a line diff settles. Every step whose cost grows with the diffs or
 * the blobs runs through `runner` (in-process by default; a step that fails
 * reads `transient`). A changed set past the file bound, a built span
 * counting each such file and candidate as two, is `too-large` before any
 * blob read.
 */
export async function readPrSpan(
  source: PrSpanSource,
  refs: PrSpanRefs,
  signal: AbortSignal,
  runner: PrSpanRunner = IN_PROCESS_SPAN_RUNNER,
): Promise<PrSpanResult> {
  const reads = await Promise.all([
    source.fetchMergeBase({ base: refs.prevBase, head: refs.prevHead }, signal),
    source.fetchMergeBase({ base: refs.newBase, head: refs.newHead }, signal),
    source.fetchMergeBase({ base: refs.prevHead, head: refs.newHead }, signal),
    source.fetchPrDiff({ base: refs.newBase, head: refs.newHead }, signal),
  ]);
  const [prevMergeBase, newMergeBase, headsMergeBase, newPrDiff] = reads;
  const hasFailure =
    !prevMergeBase.ok || !newMergeBase.ok || !headsMergeBase.ok;
  if (hasFailure || !newPrDiff.ok) {
    return { ok: false, error: pickRoundFailure(reads) };
  }

  const isSameMergeBase = prevMergeBase.value === newMergeBase.value;
  const isFastForward = headsMergeBase.value === refs.prevHead;
  if (isSameMergeBase && isFastForward) {
    return readFastForwardSpan(source, refs, newPrDiff.value, signal, runner);
  }
  return readBuiltSpan(source, refs, newPrDiff.value, signal, runner);
}

export { LINE_DIFF_TIMEOUT_MS } from "./consts";
export { buildPrSpan, isSpanUnchanged } from "./logic/build-span";
export { buildFastForwardSpan } from "./logic/fast-forward-span";
export {
  formatLineDiffPatch,
  SpanRunnerError,
  type BetweenHeadsContents,
  type LineDiffInput,
  type LineDiffRunner,
} from "./logic/line-diff";
export { planBuiltSpan } from "./logic/plan-span";
export { IN_PROCESS_SPAN_RUNNER } from "./logic/span-runner";
export {
  BetweenHeadsKinds,
  BlobReadKinds,
  PrSpanFailureKinds,
  type BaseRenameCandidate,
  type BetweenHeadsFile,
  type BlobRead,
  type BlobRef,
  type BuiltSpanPlan,
  type FastForwardSpanInput,
  type HeadTexts,
  type LineDiffFile,
  type PrDiffPair,
  type PrDiffRef,
  type PrSpan,
  type PrSpanFailure,
  type PrSpanInput,
  type PrSpanRefs,
  type PrSpanResult,
  type PrSpanRunner,
  type PrSpanSource,
} from "./types";
