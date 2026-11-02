import type { Result } from "types/utils";
import { parseHunkSpans, type FileHunkSpans, type HunkSpan } from "../remap";
import {
  FILES_PER_BASE_RENAME_CANDIDATE,
  IDENTITY_SPAN,
  MAX_SPAN_CHANGED_FILES,
} from "./consts";
import { buildBaseMovedSpans, buildLineDiffSpans } from "./logic/build-hop";
import { readChangeRuns } from "./logic/change-runs";
import { comparePrDiffs, settleBaseRenames } from "./logic/compare-patches";
import { buildFastForwardSpan } from "./logic/fast-forward-span";
import {
  formatFallbackPatch,
  formatHeaderOnlyPatch,
  formatReshapedPatch,
} from "./logic/fallback-patch";
import {
  filterBetweenHeadsHunks,
  NO_PR_CHANGE,
  readPrChangePlaces,
} from "./logic/filter-hunks";
import { pickLastingFailure } from "./logic/lasting-failure";
import { confirmBaseRenames, readBetweenHeadsFiles } from "./logic/read-blobs";
import {
  BetweenHeadsKinds,
  FileVerdicts,
  PrSpanFailureKinds,
  type BetweenHeadsFile,
  type ComparedFile,
  type PrSpan,
  type PrSpanInput,
  type PrSpanRefs,
  type PrSpanResult,
  type PrSpanFailure,
  type PrSpanSource,
} from "./types";

interface FileSpan {
  readonly isChanged: boolean;
  readonly hunks: readonly HunkSpan[];
  /** The file's part of the unfiltered span, then of the filtered one. */
  readonly unfiltered?: string;
  readonly filtered?: string;
}

function readChangedFileSpan(
  file: ComparedFile,
  betweenHeads: BetweenHeadsFile | undefined,
): FileSpan {
  if (betweenHeads?.kind !== BetweenHeadsKinds.PATCH) {
    const fallback = formatFallbackPatch(file);
    return {
      isChanged: true,
      hunks: [],
      unfiltered: fallback,
      filtered: fallback,
    };
  }

  const { patch } = betweenHeads;
  const prevPlaces = file.prev
    ? readPrChangePlaces(file.prev.runs)
    : NO_PR_CHANGE;
  const nextPlaces = file.next
    ? readPrChangePlaces(file.next.runs)
    : NO_PR_CHANGE;
  const samePath = file.prevPath === file.path;
  const patchHunks = parseHunkSpans(patch);
  if (patchHunks.length === 0) {
    return {
      isChanged: true,
      hunks: samePath ? [IDENTITY_SPAN] : [],
      unfiltered: patch,
      filtered: patch,
    };
  }
  // A range cannot stay on a path that moved, so a moved file demotes whatever its hunks say.
  const hunks = samePath ? patchHunks : [];
  // Every between-heads hunk away from the PR change is base noise, yet the PR's runs differ: send those runs.
  const filtered =
    filterBetweenHeadsHunks(
      patch,
      prevPlaces,
      nextPlaces,
      betweenHeads.texts,
    ) ?? formatFallbackPatch(file);
  return { isChanged: true, hunks, unfiltered: patch, filtered };
}

/**
 * A file whose runs match over a moved base but whose context does not:
 * changed when its line diff keeps a hunk touching either head's PR
 * change, unchanged when every between-heads edit is base noise.
 */
function readContextMovedFileSpan(
  file: ComparedFile,
  betweenHeads: BetweenHeadsFile | undefined,
): FileSpan {
  if (betweenHeads?.kind !== BetweenHeadsKinds.PATCH) {
    return readChangedFileSpan(file, betweenHeads);
  }

  const { patch } = betweenHeads;
  const hunks = buildLineDiffSpans(readChangeRuns(patch));
  const filtered = filterBetweenHeadsHunks(
    patch,
    readPrChangePlaces(file.prev?.runs ?? []),
    readPrChangePlaces(file.next?.runs ?? []),
    betweenHeads.texts,
  );
  if (filtered === undefined) {
    return { isChanged: false, hunks, unfiltered: patch };
  }
  return { isChanged: true, hunks, unfiltered: patch, filtered };
}

function readFileSpan(
  file: ComparedFile,
  betweenHeads: BetweenHeadsFile | undefined,
): FileSpan {
  if (file.verdict === FileVerdicts.IDENTICAL) {
    return { isChanged: false, hunks: [IDENTITY_SPAN] };
  }
  if (file.verdict === FileVerdicts.BASE_RENAMED) {
    return { isChanged: false, hunks: [] };
  }
  if (file.verdict === FileVerdicts.CHANGE_RESHAPED_BY_BASE) {
    const patch = formatReshapedPatch(file);
    return {
      isChanged: true,
      hunks: [IDENTITY_SPAN],
      unfiltered: patch,
      filtered: patch,
    };
  }
  if (file.verdict === FileVerdicts.BASE_MOVED) {
    const spans = buildBaseMovedSpans(
      file.prev?.runs ?? [],
      file.next?.runs ?? [],
    );
    return { isChanged: false, hunks: spans ?? [] };
  }
  if (file.verdict === FileVerdicts.CONTEXT_MOVED) {
    return readContextMovedFileSpan(file, betweenHeads);
  }
  if (file.verdict === FileVerdicts.HEADER_CHANGED) {
    const patch = formatHeaderOnlyPatch(file);
    return { isChanged: true, hunks: [], unfiltered: patch, filtered: patch };
  }
  return readChangedFileSpan(file, betweenHeads);
}

/** A file only both heads' blobs can settle: its content changed, or its context moved. */
function needsLineDiff(file: ComparedFile): boolean {
  return (
    file.verdict === FileVerdicts.CONTENT_CHANGED ||
    file.verdict === FileVerdicts.CONTEXT_MOVED
  );
}

/** A file that may read changed, so it counts against the file bound. */
function mayBeChanged(file: ComparedFile): boolean {
  return (
    needsLineDiff(file) ||
    file.verdict === FileVerdicts.HEADER_CHANGED ||
    file.verdict === FileVerdicts.CHANGE_RESHAPED_BY_BASE
  );
}

function hasBaseRenameVerdict(file: ComparedFile): boolean {
  return file.verdict === FileVerdicts.BASE_RENAMED;
}

function assemblePrSpan(
  compared: readonly ComparedFile[],
  betweenHeads: ReadonlyMap<string, BetweenHeadsFile>,
): PrSpan {
  const hop = new Map<string, FileHunkSpans>();
  const pathsByPrevPath = new Map<string, string[]>();
  const unfiltered: string[] = [];
  const filtered: string[] = [];
  const changedFiles: string[] = [];
  const unchangedFiles: string[] = [];

  for (const file of compared) {
    const fileSpan = readFileSpan(file, betweenHeads.get(file.path));
    const sharers = pathsByPrevPath.get(file.prevPath) ?? [];
    sharers.push(file.path);
    pathsByPrevPath.set(file.prevPath, sharers);
    // Two files leaving from one previous path cannot both place its ranges.
    const hunks = sharers.length > 1 ? [] : fileSpan.hunks;
    hop.set(file.prevPath, { file: file.prevPath, hunks });
    if (fileSpan.unfiltered !== undefined) {
      unfiltered.push(fileSpan.unfiltered);
    }
    if (fileSpan.filtered !== undefined) {
      filtered.push(fileSpan.filtered);
    }
    const side = fileSpan.isChanged ? changedFiles : unchangedFiles;
    side.push(file.path);
  }

  const hopEntries = [...hop.values()];
  const filteredDiff = filtered.join("\n");
  const unpairableFiles = hopEntries
    .filter((entry) => entry.hunks.length === 0)
    .flatMap((entry) => pathsByPrevPath.get(entry.file) ?? []);
  return {
    changedFiles,
    unchangedFiles,
    unpairableFiles,
    filteredDiff,
    unfilteredDiff: unfiltered.join("\n"),
    hop: hopEntries,
    isUnchanged: isSpanUnchanged(filteredDiff),
  };
}

/**
 * The no-change rule the worker, the dev CLI and the eval harness share:
 * every changed file adds text to the filtered diff, so an empty one means
 * the PR's own change did not move.
 */
export function isSpanUnchanged(filteredDiff: string): boolean {
  return filteredDiff === "";
}

/**
 * The revision span between two heads from both heads' PR diffs and the
 * between-heads patch of each file `readPrSpan` line-diffs, keyed by its
 * new-head path. Such a file with no patch reads changed and takes the
 * patch-level fallback.
 */
export function buildPrSpan(input: PrSpanInput): PrSpan {
  const compared = comparePrDiffs(input.prevPrDiff, input.newPrDiff);
  const settled = settleBaseRenames(
    compared,
    input.baseRenames ?? new Set<string>(),
  );
  return assemblePrSpan(settled, input.betweenHeads);
}

function pickRoundFailure(
  reads: readonly Result<unknown, PrSpanFailure>[],
): PrSpanFailure {
  const failures = reads.flatMap((read) => (read.ok ? [] : [read.error]));
  return failures.reduce(pickLastingFailure);
}

async function readFastForwardSpan(
  source: PrSpanSource,
  refs: PrSpanRefs,
  newPrDiff: string,
  signal: AbortSignal,
): Promise<PrSpanResult> {
  const betweenHeads = await source.fetchPrDiff(
    { base: refs.prevHead, head: refs.newHead },
    signal,
  );
  if (!betweenHeads.ok) {
    return betweenHeads;
  }

  const span = buildFastForwardSpan({
    betweenHeadsDiff: betweenHeads.value,
    newPrDiff,
  });
  if (span.changedFiles.length > MAX_SPAN_CHANGED_FILES) {
    return { ok: false, error: { kind: PrSpanFailureKinds.TOO_LARGE } };
  }
  return { ok: true, value: span };
}

async function readBuiltSpan(
  source: PrSpanSource,
  refs: PrSpanRefs,
  newPrDiff: string,
  signal: AbortSignal,
): Promise<PrSpanResult> {
  const prevPrDiff = await source.fetchPrDiff(
    { base: refs.prevBase, head: refs.prevHead },
    signal,
  );
  if (!prevPrDiff.ok) {
    return prevPrDiff;
  }

  const compared = comparePrDiffs(prevPrDiff.value, newPrDiff);
  const candidates = compared.filter(hasBaseRenameVerdict);
  const changedCount =
    compared.filter(mayBeChanged).length +
    candidates.length * FILES_PER_BASE_RENAME_CANDIDATE;
  if (changedCount > MAX_SPAN_CHANGED_FILES) {
    return { ok: false, error: { kind: PrSpanFailureKinds.TOO_LARGE } };
  }

  const confirmed = await confirmBaseRenames(source, refs, candidates, signal);
  if (!confirmed.ok) {
    return confirmed;
  }
  const settled = settleBaseRenames(compared, confirmed.value);
  const betweenHeads = await readBetweenHeadsFiles(
    source,
    refs,
    settled.filter(needsLineDiff),
    signal,
  );
  if (!betweenHeads.ok) {
    return betweenHeads;
  }
  return { ok: true, value: assemblePrSpan(settled, betweenHeads.value) };
}

/**
 * Read the revision span through `source`. A fast-forward over an unmoved
 * merge base is the between-heads compare as GitHub serves it, past the
 * file bound `too-large`. Anything else is built from both heads' PR
 * diffs: the swapped paths of each base-rename candidate, then both blobs
 * of each content-changed file and of each file whose runs match over a
 * moved base with different context. A built span's changed set past the
 * file bound, counting each such file and each candidate as the two
 * changed files it may split into, is `too-large` before any blob read.
 */
export async function readPrSpan(
  source: PrSpanSource,
  refs: PrSpanRefs,
  signal: AbortSignal,
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
    return readFastForwardSpan(source, refs, newPrDiff.value, signal);
  }
  return readBuiltSpan(source, refs, newPrDiff.value, signal);
}

export {
  BetweenHeadsKinds,
  BlobReadKinds,
  PrSpanFailureKinds,
  type BetweenHeadsFile,
  type BlobRead,
  type BlobRef,
  type PrDiffRef,
  type PrSpan,
  type PrSpanFailure,
  type PrSpanInput,
  type PrSpanRefs,
  type PrSpanResult,
  type PrSpanSource,
} from "./types";
