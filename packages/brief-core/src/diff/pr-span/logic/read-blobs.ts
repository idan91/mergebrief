import type { Result } from "types/utils";
import {
  BLOB_READ_CONCURRENCY,
  LINE_DIFF_CHARS_PER_LINE,
  LINE_DIFF_MAX_EDIT_LENGTH,
  LINE_DIFF_MAX_WORK_SHARE,
  MAX_LINE_DIFF_BYTES,
  SPAN_LINE_DIFF_MAX_CHARS,
  SPAN_LINE_DIFF_MAX_LINES,
  SPAN_LINE_DIFF_MAX_WORK,
  WIDE_TEXT_CHAR_WEIGHT,
  WIDE_TEXT_UNIT,
} from "../consts";
import {
  BetweenHeadsKinds,
  BlobReadKinds,
  PrSpanFailureKinds,
  type BetweenHeadsFile,
  type BlobRead,
  type ComparedFile,
  type HeadTexts,
  type PrSpanFailure,
  type PrSpanRefs,
  type PrSpanSource,
} from "../types";
import { readChangeRuns } from "./change-runs";
import { compareFilePaths } from "./compare-patches";
import { splitTextLines } from "./utils";
import { pickLastingFailure } from "./lasting-failure";
import {
  isPastByteBound,
  SpanRunnerError,
  type BetweenHeadsContents,
  type LineDiffInput,
  type LineDiffRunner,
} from "./line-diff";

/** Both heads' blobs of one changed file. */
interface HeadBlobs {
  readonly prev: BlobRead;
  readonly next: BlobRead;
}

/**
 * What the span may still spend on line diffs. Once a file's text cannot
 * be afforded every later file falls back; a file whose diff cannot be
 * afforded falls back alone.
 */
interface LineDiffBudget {
  remainingLines: number;
  remainingChars: number;
  remainingWork: number;
  isSpent: boolean;
}

/** The span-wide line-diff bounds: blob lines and weighted characters read, and compare cost times edit length spent. */
export interface SpanLineDiffBounds {
  readonly maxLines: number;
  readonly maxChars: number;
  readonly maxWork: number;
}

/** Both heads' lines of a file the span's text bounds afforded, and its weighted characters. */
interface AffordedText {
  readonly weightedChars: number;
  readonly prevLines: readonly string[];
  readonly newLines: readonly string[];
}

const DEFAULT_SPAN_BOUNDS: SpanLineDiffBounds = {
  maxLines: SPAN_LINE_DIFF_MAX_LINES,
  maxChars: SPAN_LINE_DIFF_MAX_CHARS,
  maxWork: SPAN_LINE_DIFF_MAX_WORK,
};

const UNREADABLE: BetweenHeadsFile = { kind: BetweenHeadsKinds.UNREADABLE };

const READ_UNREADABLE: Result<BetweenHeadsFile, PrSpanFailure> = {
  ok: true,
  value: UNREADABLE,
};

function readTextContent(blob: BlobRead): string | undefined {
  return blob.kind === BlobReadKinds.TEXT ? blob.content : undefined;
}

function isLineDiffable(blobs: HeadBlobs): boolean {
  const anyUnreadable =
    blobs.prev.kind === BlobReadKinds.UNREADABLE ||
    blobs.next.kind === BlobReadKinds.UNREADABLE;
  // A changed file absent at both heads means the port and the PR diffs disagree: not evidence of identity.
  const bothAbsent =
    blobs.prev.kind === BlobReadKinds.ABSENT &&
    blobs.next.kind === BlobReadKinds.ABSENT;
  return !anyUnreadable && !bothAbsent;
}

/**
 * The file's characters, weighted when either side holds wide text, charged
 * to the character bound before anything reads the text; nothing, and the
 * budget spent, when the bound cannot afford them.
 */
function chargeChars(
  texts: HeadTexts,
  budget: LineDiffBudget,
): number | undefined {
  const prev = texts.prevContent ?? "";
  const next = texts.newContent ?? "";
  const chars = prev.length + next.length;
  if (budget.isSpent || chars > budget.remainingChars) {
    budget.isSpent = true;
    return undefined;
  }
  const isWide = WIDE_TEXT_UNIT.test(prev) || WIDE_TEXT_UNIT.test(next);
  const weightedChars = isWide ? chars * WIDE_TEXT_CHAR_WEIGHT : chars;
  if (weightedChars > budget.remainingChars) {
    budget.isSpent = true;
    return undefined;
  }
  budget.remainingChars -= weightedChars;
  return weightedChars;
}

/**
 * Both heads' lines, charged to the line bound; nothing when a side passes
 * the byte bound, and nothing with the budget spent when the line bound
 * cannot afford them.
 */
function chargeText(
  texts: HeadTexts,
  budget: LineDiffBudget,
): AffordedText | undefined {
  const weightedChars = chargeChars(texts, budget);
  if (weightedChars === undefined) {
    return undefined;
  }
  const isTooLarge =
    isPastByteBound(texts.prevContent) || isPastByteBound(texts.newContent);
  if (isTooLarge) {
    return undefined;
  }

  const prevLines = splitTextLines(texts.prevContent);
  const newLines = splitTextLines(texts.newContent);
  const lines = prevLines.length + newLines.length;
  if (lines > budget.remainingLines) {
    budget.isSpent = true;
    return undefined;
  }
  budget.remainingLines -= lines;
  return { weightedChars, prevLines, newLines };
}

/**
 * The fewest lines any line diff of the two sides adds and removes: each
 * line one side holds more copies of than the other. jsdiff's edit length
 * is at least this, so a file allowed less would fall back anyway.
 */
function countLeastEditLength(
  prevLines: readonly string[],
  newLines: readonly string[],
): number {
  const surplus = new Map<string, number>();
  for (const line of prevLines) {
    surplus.set(line, (surplus.get(line) ?? 0) + 1);
  }
  for (const line of newLines) {
    surplus.set(line, (surplus.get(line) ?? 0) - 1);
  }
  let least = 0;
  for (const count of surplus.values()) {
    least += Math.abs(count);
  }
  return least;
}

/** The edit length a file of this compare cost may reach in its share of the work left. */
function affordEditLength(compareCost: number, budget: LineDiffBudget): number {
  const share = budget.remainingWork * LINE_DIFF_MAX_WORK_SHARE;
  const affordable = Math.floor(share / Math.max(compareCost, 1));
  return Math.min(LINE_DIFF_MAX_EDIT_LENGTH, affordable);
}

function countEditLength(patch: string): number {
  return readChangeRuns(patch).reduce(
    (sum, run) => sum + run.added + run.removed,
    0,
  );
}

/**
 * The runner's answer. A `SpanRunnerError` is infrastructure, not the
 * file's content, so the span reads transient; an aborted read throws the
 * signal's reason, and any other throw is a bug that propagates.
 */
async function runBoundedLineDiff(
  runLineDiff: LineDiffRunner,
  input: LineDiffInput,
  signal: AbortSignal,
): Promise<Result<string | undefined, PrSpanFailure>> {
  try {
    return { ok: true, value: await runLineDiff(input, signal) };
  } catch (error) {
    signal.throwIfAborted();
    if (!(error instanceof SpanRunnerError)) {
      throw error;
    }
    return { ok: false, error: { kind: PrSpanFailureKinds.TRANSIENT } };
  }
}

/**
 * The file's line diff, its edit length capped by its share of the work
 * left, decided before the runner sees the file so every runner gets the
 * same input. A file whose share affords no edit, or whose least edit
 * length passes that cap, falls back with nothing charged and never reaches
 * a runner; one whose diff passes it falls back charged for the cap. Past
 * the byte bound the file falls back alone: the content decided it, so a
 * retry would decide it again. The time limit, a crash-only stop,
 * takes the fallback too.
 */
async function diffWithinBound(
  file: ComparedFile,
  blobs: HeadBlobs,
  budget: LineDiffBudget,
  runLineDiff: LineDiffRunner,
  signal: AbortSignal,
): Promise<Result<BetweenHeadsFile, PrSpanFailure>> {
  if (!isLineDiffable(blobs)) {
    return READ_UNREADABLE;
  }
  const texts: HeadTexts = {
    prevContent: readTextContent(blobs.prev),
    newContent: readTextContent(blobs.next),
  };
  const afforded = chargeText(texts, budget);
  if (afforded === undefined) {
    return READ_UNREADABLE;
  }
  const { weightedChars, prevLines, newLines } = afforded;
  const lines = prevLines.length + newLines.length;
  const compareCost = weightedChars + lines * LINE_DIFF_CHARS_PER_LINE;
  const maxEditLength = affordEditLength(compareCost, budget);
  const isUnaffordable =
    maxEditLength < 1 ||
    countLeastEditLength(prevLines, newLines) > maxEditLength;
  if (isUnaffordable) {
    return READ_UNREADABLE;
  }

  signal.throwIfAborted();
  const contents: BetweenHeadsContents = {
    prevPath: file.prevPath,
    path: file.path,
    ...texts,
    modeChange: file.modeChange,
    prevMode: file.prev?.mode,
    newMode: file.next?.mode,
  };
  const patch = await runBoundedLineDiff(
    runLineDiff,
    { contents, maxEditLength },
    signal,
  );
  if (!patch.ok) {
    return patch;
  }

  const editLength =
    patch.value === undefined ? maxEditLength : countEditLength(patch.value);
  budget.remainingWork -= compareCost * editLength;
  if (patch.value === undefined) {
    return READ_UNREADABLE;
  }
  return {
    ok: true,
    value: { kind: BetweenHeadsKinds.PATCH, patch: patch.value, texts },
  };
}

async function readHeadBlobs(
  source: PrSpanSource,
  refs: PrSpanRefs,
  file: ComparedFile,
  signal: AbortSignal,
): Promise<Result<HeadBlobs, PrSpanFailure>> {
  const [prevBlob, newBlob] = await Promise.all([
    source.fetchBlob(
      {
        path: file.prevPath,
        ref: refs.prevHead,
        maxBytes: MAX_LINE_DIFF_BYTES,
      },
      signal,
    ),
    source.fetchBlob(
      { path: file.path, ref: refs.newHead, maxBytes: MAX_LINE_DIFF_BYTES },
      signal,
    ),
  ]);
  if (!prevBlob.ok && !newBlob.ok) {
    const error = pickLastingFailure(prevBlob.error, newBlob.error);
    return { ok: false, error };
  }
  if (!prevBlob.ok) {
    return prevBlob;
  }
  if (!newBlob.ok) {
    return newBlob;
  }
  return { ok: true, value: { prev: prevBlob.value, next: newBlob.value } };
}

/** The batch's blobs, or its most lasting failure. */
async function readBatchBlobs(
  source: PrSpanSource,
  refs: PrSpanRefs,
  batch: readonly ComparedFile[],
  signal: AbortSignal,
): Promise<Result<HeadBlobs[], PrSpanFailure>> {
  const reads = await Promise.all(
    batch.map((file) => readHeadBlobs(source, refs, file, signal)),
  );
  const blobs: HeadBlobs[] = [];
  let failure: PrSpanFailure | undefined;
  for (const read of reads) {
    if (read.ok) {
      blobs.push(read.value);
    } else {
      failure =
        failure === undefined
          ? read.error
          : pickLastingFailure(failure, read.error);
    }
  }
  if (failure !== undefined) {
    return { ok: false, error: failure };
  }
  return { ok: true, value: blobs };
}

/**
 * Both heads' blobs of every content-changed file, a few at a time, each
 * diffed through `runLineDiff` in path order while the span's bounds afford
 * it. The file whose text the line or character bound cannot afford and
 * every later one fall back, with no later batch read; a file whose diff its
 * share of the work left cannot afford falls back alone. The time limit is a
 * crash-only stop. A failed read fails the span, a batch's most lasting
 * failure winning, and a failed runner reads transient; an aborted signal
 * throws its reason before each batch and diff.
 */
export async function readBetweenHeadsFiles(
  source: PrSpanSource,
  refs: PrSpanRefs,
  files: readonly ComparedFile[],
  signal: AbortSignal,
  runLineDiff: LineDiffRunner,
  bounds: SpanLineDiffBounds = DEFAULT_SPAN_BOUNDS,
): Promise<Result<Map<string, BetweenHeadsFile>, PrSpanFailure>> {
  const ordered = files.toSorted(compareFilePaths);
  const betweenHeads = new Map<string, BetweenHeadsFile>();
  const budget: LineDiffBudget = {
    remainingLines: bounds.maxLines,
    remainingChars: bounds.maxChars,
    remainingWork: bounds.maxWork,
    isSpent: false,
  };
  for (let start = 0; start < ordered.length; start += BLOB_READ_CONCURRENCY) {
    signal.throwIfAborted();
    const batch = ordered.slice(start, start + BLOB_READ_CONCURRENCY);
    if (budget.isSpent) {
      batch.forEach((file) => betweenHeads.set(file.path, UNREADABLE));
      continue;
    }

    const blobs = await readBatchBlobs(source, refs, batch, signal);
    if (!blobs.ok) {
      return blobs;
    }
    for (const [index, fileBlobs] of blobs.value.entries()) {
      const file = batch[index];
      if (file === undefined) {
        continue;
      }
      const diffed = await diffWithinBound(
        file,
        fileBlobs,
        budget,
        runLineDiff,
        signal,
      );
      if (!diffed.ok) {
        return diffed;
      }
      betweenHeads.set(file.path, diffed.value);
    }
  }
  signal.throwIfAborted();
  return { ok: true, value: betweenHeads };
}

function isAbsent(read: Result<BlobRead, PrSpanFailure>): boolean {
  return read.ok && read.value.kind === BlobReadKinds.ABSENT;
}

/** A base rename holds when neither head has a file at the other head's path. */
async function probeBaseRename(
  source: PrSpanSource,
  refs: PrSpanRefs,
  file: ComparedFile,
  signal: AbortSignal,
): Promise<Result<boolean, PrSpanFailure>> {
  const [atPrevHead, atNewHead] = await Promise.all([
    source.fetchBlob(
      { path: file.path, ref: refs.prevHead, maxBytes: MAX_LINE_DIFF_BYTES },
      signal,
    ),
    source.fetchBlob(
      {
        path: file.prevPath,
        ref: refs.newHead,
        maxBytes: MAX_LINE_DIFF_BYTES,
      },
      signal,
    ),
  ]);
  if (!atPrevHead.ok && !atNewHead.ok) {
    const error = pickLastingFailure(atPrevHead.error, atNewHead.error);
    return { ok: false, error };
  }
  if (!atPrevHead.ok) {
    return atPrevHead;
  }
  if (!atNewHead.ok) {
    return atNewHead;
  }
  return { ok: true, value: isAbsent(atPrevHead) && isAbsent(atNewHead) };
}

/**
 * The new-head paths of the base-rename candidates the swapped-path reads
 * confirm; a failed read fails the span. Equal base SHAs still read: each
 * PR diff starts at its head's merge base, which a catch-up merge moves.
 */
export async function confirmBaseRenames(
  source: PrSpanSource,
  refs: PrSpanRefs,
  candidates: readonly ComparedFile[],
  signal: AbortSignal,
): Promise<Result<Set<string>, PrSpanFailure>> {
  const confirmed = new Set<string>();
  for (
    let start = 0;
    start < candidates.length;
    start += BLOB_READ_CONCURRENCY
  ) {
    signal.throwIfAborted();
    const batch = candidates.slice(start, start + BLOB_READ_CONCURRENCY);
    const probes = await Promise.all(
      batch.map((file) => probeBaseRename(source, refs, file, signal)),
    );

    let failure: PrSpanFailure | undefined;
    for (const [index, probe] of probes.entries()) {
      const file = batch[index];
      if (!probe.ok) {
        failure =
          failure === undefined
            ? probe.error
            : pickLastingFailure(failure, probe.error);
      } else if (probe.value && file !== undefined) {
        confirmed.add(file.path);
      }
    }
    if (failure !== undefined) {
      return { ok: false, error: failure };
    }
  }
  return { ok: true, value: confirmed };
}
