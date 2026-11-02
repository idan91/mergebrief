import { parseHunkSpans, type FileHunkSpans, type HunkSpan } from "../remap";
import {
  FILES_PER_BASE_RENAME_CANDIDATE,
  IDENTITY_SPAN,
  MAX_SPAN_CHANGED_FILES,
} from "./consts";
import { buildBaseMovedSpans } from "./logic/build-hop";
import { comparePrDiffs, settleBaseRenames } from "./logic/compare-patches";
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
  type FileVerdict,
  type PrSpan,
  type PrSpanInput,
  type PrSpanRefs,
  type PrSpanResult,
  type PrSpanSource,
} from "./types";

interface FileSpan {
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
    return { hunks: [], unfiltered: fallback, filtered: fallback };
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
      hunks: samePath ? [IDENTITY_SPAN] : [],
      unfiltered: patch,
      filtered: patch,
    };
  }
  // A range cannot stay on a path that moved, so a moved file demotes whatever its hunks say.
  const hunks = samePath ? patchHunks : [];
  const filtered = filterBetweenHeadsHunks(patch, prevPlaces, nextPlaces);
  if (filtered === undefined) {
    return { hunks, unfiltered: patch };
  }
  return { hunks, unfiltered: patch, filtered };
}

function readFileSpan(
  file: ComparedFile,
  betweenHeads: BetweenHeadsFile | undefined,
): FileSpan {
  if (file.verdict === FileVerdicts.IDENTICAL) {
    return { hunks: [IDENTITY_SPAN] };
  }
  if (file.verdict === FileVerdicts.BASE_RENAMED) {
    return { hunks: [] };
  }
  if (file.verdict === FileVerdicts.CHANGE_RESHAPED_BY_BASE) {
    const patch = formatReshapedPatch(file);
    return { hunks: [IDENTITY_SPAN], unfiltered: patch, filtered: patch };
  }
  if (file.verdict === FileVerdicts.BASE_MOVED) {
    const spans = buildBaseMovedSpans(
      file.prev?.runs ?? [],
      file.next?.runs ?? [],
    );
    return { hunks: spans ?? [] };
  }
  if (file.verdict === FileVerdicts.HEADER_CHANGED) {
    const patch = formatHeaderOnlyPatch(file);
    return { hunks: [], unfiltered: patch, filtered: patch };
  }
  return readChangedFileSpan(file, betweenHeads);
}

function isContentChanged(file: ComparedFile): boolean {
  return file.verdict === FileVerdicts.CONTENT_CHANGED;
}

const CHANGED_VERDICTS: ReadonlySet<FileVerdict> = new Set([
  FileVerdicts.CONTENT_CHANGED,
  FileVerdicts.HEADER_CHANGED,
  FileVerdicts.CHANGE_RESHAPED_BY_BASE,
]);

function isChanged(file: ComparedFile): boolean {
  return CHANGED_VERDICTS.has(file.verdict);
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
  }

  const hopEntries = [...hop.values()];
  const unpairableFiles = hopEntries
    .filter((entry) => entry.hunks.length === 0)
    .flatMap((entry) => pathsByPrevPath.get(entry.file) ?? []);
  const changedFiles = compared.filter(isChanged).map((file) => file.path);
  return {
    changedFiles,
    unchangedFiles: compared
      .filter((file) => !isChanged(file))
      .map((file) => file.path),
    unpairableFiles,
    filteredDiff: filtered.join("\n"),
    unfilteredDiff: unfiltered.join("\n"),
    hop: hopEntries,
    isUnchanged: changedFiles.length === 0,
  };
}

/**
 * The revision span between two heads from both heads' PR diffs and the
 * between-heads patch of each content-changed file, keyed by its new-head
 * path. A content-changed file with no patch takes the patch-level fallback.
 */
export function buildPrSpan(input: PrSpanInput): PrSpan {
  const compared = comparePrDiffs(input.prevPrDiff, input.newPrDiff);
  const settled = settleBaseRenames(
    compared,
    input.baseRenames ?? new Set<string>(),
  );
  return assemblePrSpan(settled, input.betweenHeads);
}

/**
 * Read the revision span through `source`: both heads' PR diffs, the
 * swapped paths of each base-rename candidate, then both blobs of each
 * content-changed file. A changed set past the file bound, counting each
 * candidate as the two changed files it may split into, is `too-large`
 * before any blob read.
 */
export async function readPrSpan(
  source: PrSpanSource,
  refs: PrSpanRefs,
  signal: AbortSignal,
): Promise<PrSpanResult> {
  const [prevPrDiff, newPrDiff] = await Promise.all([
    source.fetchPrDiff({ base: refs.prevBase, head: refs.prevHead }, signal),
    source.fetchPrDiff({ base: refs.newBase, head: refs.newHead }, signal),
  ]);
  if (!prevPrDiff.ok && !newPrDiff.ok) {
    const error = pickLastingFailure(prevPrDiff.error, newPrDiff.error);
    return { ok: false, error };
  }
  if (!prevPrDiff.ok) {
    return prevPrDiff;
  }
  if (!newPrDiff.ok) {
    return newPrDiff;
  }

  const compared = comparePrDiffs(prevPrDiff.value, newPrDiff.value);
  const candidates = compared.filter(hasBaseRenameVerdict);
  const changedCount =
    compared.filter(isChanged).length +
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
    settled.filter(isContentChanged),
    signal,
  );
  if (!betweenHeads.ok) {
    return betweenHeads;
  }
  return { ok: true, value: assemblePrSpan(settled, betweenHeads.value) };
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
