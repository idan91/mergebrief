import { parseHunkSpans, type FileHunkSpans, type HunkSpan } from "../../remap";
import { IDENTITY_SPAN } from "../consts";
import {
  BetweenHeadsKinds,
  FileVerdicts,
  type BetweenHeadsFile,
  type ComparedFile,
  type PrSpan,
  type PrSpanInput,
} from "../types";
import { buildBaseMovedSpans, buildLineDiffSpans } from "./build-hop";
import { readChangeRuns } from "./change-runs";
import { comparePrDiffs, settleBaseRenames } from "./compare-patches";
import {
  formatFallbackPatch,
  formatHeaderOnlyPatch,
  formatReshapedPatch,
} from "./fallback-patch";
import {
  filterBetweenHeadsHunks,
  NO_PR_CHANGE,
  readPrChangePlaces,
} from "./filter-hunks";

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
