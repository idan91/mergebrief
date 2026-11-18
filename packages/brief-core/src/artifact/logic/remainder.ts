import type { Chunk, LineRange, UnattributedFile } from "../../types";

type ChunkLines = Pick<Chunk, "file" | "addedRanges" | "removedRanges">;

/** Sorted, with overlapping and touching ranges joined. */
function mergeRanges(ranges: readonly LineRange[]): LineRange[] {
  const sorted = ranges.toSorted((left, right) => left.start - right.start);
  const merged: LineRange[] = [];

  for (const range of sorted) {
    const last = merged.at(-1);
    const touchesLast = last !== undefined && range.start <= last.end + 1;
    if (touchesLast) {
      last.end = Math.max(last.end, range.end);
      continue;
    }
    merged.push({ ...range });
  }

  return merged;
}

/**
 * Adds each chunk's changed lines to its file's remainder entry, opening one
 * for a file the remainder does not list yet.
 */
export function addChunksToRemainder(
  remainder: readonly UnattributedFile[],
  chunks: readonly ChunkLines[],
): UnattributedFile[] {
  const files = remainder.map((entry) => ({ ...entry }));

  for (const chunk of chunks) {
    const entry = files.find((file) => file.file === chunk.file);
    if (entry === undefined) {
      files.push({
        file: chunk.file,
        addedRanges: mergeRanges(chunk.addedRanges),
        removedRanges: mergeRanges(chunk.removedRanges),
      });
      continue;
    }
    entry.addedRanges = mergeRanges([
      ...entry.addedRanges,
      ...chunk.addedRanges,
    ]);
    entry.removedRanges = mergeRanges([
      ...entry.removedRanges,
      ...chunk.removedRanges,
    ]);
  }

  return files;
}
