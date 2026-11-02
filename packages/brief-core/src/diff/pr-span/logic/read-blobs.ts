import type { Result } from "types/utils";
import {
  BLOB_READ_CONCURRENCY,
  LINE_DIFF_MAX_EDIT_LENGTH,
  LINE_DIFF_TIMEOUT_MS,
  MAX_LINE_DIFF_BYTES,
  SPAN_LINE_DIFF_BUDGET_MS,
} from "../consts";
import {
  BetweenHeadsKinds,
  BlobReadKinds,
  type BetweenHeadsFile,
  type BlobRead,
  type ComparedFile,
  type PrSpanFailure,
  type PrSpanRefs,
  type PrSpanSource,
} from "../types";
import { pickLastingFailure } from "./lasting-failure";
import { formatBetweenHeadsPatch } from "./line-diff";

type BetweenHeadsRead = Result<BetweenHeadsFile, PrSpanFailure>;

/** Line-diff time the span has left; shared by every file of one read. */
interface LineDiffBudget {
  remainingMs: number;
}

const UNREADABLE: BetweenHeadsRead = {
  ok: true,
  value: { kind: BetweenHeadsKinds.UNREADABLE },
};

function readTextContent(blob: BlobRead): string | undefined {
  return blob.kind === BlobReadKinds.TEXT ? blob.content : undefined;
}

function isLineDiffable(prevBlob: BlobRead, newBlob: BlobRead): boolean {
  const anyUnreadable =
    prevBlob.kind === BlobReadKinds.UNREADABLE ||
    newBlob.kind === BlobReadKinds.UNREADABLE;
  // A changed file absent at both heads means the port and the PR diffs disagree: not evidence of identity.
  const bothAbsent =
    prevBlob.kind === BlobReadKinds.ABSENT &&
    newBlob.kind === BlobReadKinds.ABSENT;
  return !anyUnreadable && !bothAbsent;
}

/** The file's line diff under what is left of the budget, charging the time it took. */
function diffWithinBudget(
  file: ComparedFile,
  prevBlob: BlobRead,
  newBlob: BlobRead,
  budget: LineDiffBudget,
): BetweenHeadsRead {
  if (budget.remainingMs <= 0) {
    return UNREADABLE;
  }

  const startedAt = performance.now();
  const patch = formatBetweenHeadsPatch(
    {
      prevPath: file.prevPath,
      path: file.path,
      prevContent: readTextContent(prevBlob),
      newContent: readTextContent(newBlob),
      modeChange: file.modeChange,
      prevMode: file.prev?.mode,
      newMode: file.next?.mode,
    },
    {
      maxEditLength: LINE_DIFF_MAX_EDIT_LENGTH,
      timeoutMs: Math.min(LINE_DIFF_TIMEOUT_MS, budget.remainingMs),
    },
  );
  budget.remainingMs -= performance.now() - startedAt;
  if (patch === undefined) {
    return UNREADABLE;
  }
  return { ok: true, value: { kind: BetweenHeadsKinds.PATCH, patch } };
}

async function readBetweenHeadsFile(
  source: PrSpanSource,
  refs: PrSpanRefs,
  file: ComparedFile,
  signal: AbortSignal,
  budget: LineDiffBudget,
): Promise<BetweenHeadsRead> {
  if (budget.remainingMs <= 0) {
    return UNREADABLE;
  }

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

  if (!isLineDiffable(prevBlob.value, newBlob.value)) {
    return UNREADABLE;
  }
  signal.throwIfAborted();
  return diffWithinBudget(file, prevBlob.value, newBlob.value, budget);
}

/**
 * Both heads' blobs of every content-changed file, diffed line by line, a
 * few files at a time, within one line-diff time budget: past it the
 * remaining files read unreadable. A failed read fails the span, the most
 * lasting failure of a batch winning; an aborted signal throws its reason
 * before the next batch and before each file's diff.
 */
export async function readBetweenHeadsFiles(
  source: PrSpanSource,
  refs: PrSpanRefs,
  files: readonly ComparedFile[],
  signal: AbortSignal,
  budgetMs: number = SPAN_LINE_DIFF_BUDGET_MS,
): Promise<Result<Map<string, BetweenHeadsFile>, PrSpanFailure>> {
  const betweenHeads = new Map<string, BetweenHeadsFile>();
  const budget: LineDiffBudget = { remainingMs: budgetMs };
  for (let start = 0; start < files.length; start += BLOB_READ_CONCURRENCY) {
    signal.throwIfAborted();
    const batch = files.slice(start, start + BLOB_READ_CONCURRENCY);
    const reads = await Promise.all(
      batch.map((file) =>
        readBetweenHeadsFile(source, refs, file, signal, budget),
      ),
    );

    let failure: PrSpanFailure | undefined;
    for (const [index, read] of reads.entries()) {
      const file = batch[index];
      if (!read.ok) {
        failure =
          failure === undefined
            ? read.error
            : pickLastingFailure(failure, read.error);
      } else if (file !== undefined) {
        betweenHeads.set(file.path, read.value);
      }
    }
    if (failure !== undefined) {
      return { ok: false, error: failure };
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
