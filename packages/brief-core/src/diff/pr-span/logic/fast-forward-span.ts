import { parsePatchPaths } from "../../chunk-layout/logic/header-paths";
import { splitDiffByFile } from "../../file-diff";
import { parseHunkSpans, type FileHunkSpans, type HunkSpan } from "../../remap";
import { IDENTITY_SPAN } from "../consts";
import type { FastForwardSpanInput, PrSpan } from "../types";

interface BetweenHeadsEntry {
  readonly prevPath: string;
  readonly path: string;
  readonly hunks: readonly HunkSpan[];
}

function readBetweenHeadsEntries(diff: string): BetweenHeadsEntry[] {
  return splitDiffByFile(diff).map(({ file, patch }) => {
    const paths = parsePatchPaths(patch);
    const prevPath = paths?.pre ?? file;
    const path = paths?.post ?? file;
    // A range cannot stay on a path that moved; a file with no hunks (binary, mode-only) cannot place one.
    const hunks = prevPath === path ? parseHunkSpans(patch) : [];
    return { prevPath, path, hunks };
  });
}

function readPrPaths(newPrDiff: string): string[] {
  return splitDiffByFile(newPrDiff).map(
    ({ file, patch }) => parsePatchPaths(patch)?.post ?? file,
  );
}

/**
 * The revision span of a fast-forward over an unmoved merge base: every
 * change between the heads is the PR's own, so the between-heads diff is
 * the span, filtered and unfiltered alike. A new-head PR file it does not
 * touch is unchanged and keeps an identity hop entry; a path the push
 * renamed away is zero-hunk whatever else lands on it.
 */
export function buildFastForwardSpan(input: FastForwardSpanInput): PrSpan {
  const entries = readBetweenHeadsEntries(input.betweenHeadsDiff);
  const hop = new Map<string, FileHunkSpans>();
  const pathsByPrevPath = new Map<string, string[]>();
  for (const entry of entries) {
    hop.set(entry.prevPath, { file: entry.prevPath, hunks: entry.hunks });
    const sharers = pathsByPrevPath.get(entry.prevPath) ?? [];
    sharers.push(entry.path);
    pathsByPrevPath.set(entry.prevPath, sharers);
  }
  for (const entry of entries) {
    if (entry.prevPath !== entry.path) {
      hop.set(entry.prevPath, { file: entry.prevPath, hunks: [] });
    }
  }

  const changedFiles = entries.map((entry) => entry.path);
  const changed = new Set(changedFiles);
  const unchangedFiles = readPrPaths(input.newPrDiff).filter(
    (path) => !changed.has(path),
  );
  for (const path of unchangedFiles) {
    if (!hop.has(path)) {
      hop.set(path, { file: path, hunks: [IDENTITY_SPAN] });
    }
  }

  const hopEntries = [...hop.values()];
  const unpairableFiles = hopEntries
    .filter((entry) => entry.hunks.length === 0)
    .flatMap((entry) => pathsByPrevPath.get(entry.file) ?? []);
  const diff = entries.length === 0 ? "" : input.betweenHeadsDiff;
  return {
    changedFiles,
    unchangedFiles,
    unpairableFiles,
    filteredDiff: diff,
    unfilteredDiff: diff,
    hop: hopEntries,
    isUnchanged: entries.length === 0,
  };
}
