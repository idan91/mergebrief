import type { RevisionChangeFile } from "../diff/revchanges";
import type { Chunk, LineRange } from "../types";
import { countLines, intersectRanges } from "./loc";
import {
  GenerationWarningKinds,
  type WarningCollector,
} from "./warnings/types";

type ChunkRanges = Pick<Chunk, "file" | "addedRanges" | "removedRanges">;
type RangeSide = "addedRanges" | "removedRanges";

/** The one-line moves tried for a range sitting wholly off the changed lines. */
const LINE_SHIFTS = [-1, 1] as const;

/** One file side's changed lines and those any chunk claims, both bounded by the diff. */
interface SideLines {
  changedRanges: LineRange[];
  changed: ReadonlySet<number>;
  claimed: Set<number>;
}

interface AlignmentTally {
  shiftedRanges: number;
  clippedLines: number;
}

function addLines(lines: Set<number>, ranges: readonly LineRange[]): void {
  for (const range of ranges) {
    for (let line = range.start; line <= range.end; line += 1) {
      lines.add(line);
    }
  }
}

function buildSideLines(
  changedRanges: LineRange[],
  claims: LineRange[],
): SideLines {
  const changed = new Set<number>();
  addLines(changed, changedRanges);
  const claimed = new Set<number>();
  addLines(claimed, intersectRanges(claims, changedRanges));
  return { changedRanges, changed, claimed };
}

function groupByFile<C extends ChunkRanges>(
  chunks: readonly C[],
): Map<string, C[]> {
  const byFile = new Map<string, C[]>();
  for (const chunk of chunks) {
    const fileChunks = byFile.get(chunk.file) ?? [];
    fileChunks.push(chunk);
    byFile.set(chunk.file, fileChunks);
  }
  return byFile;
}

/**
 * The changed ranges by path, entries under one path merged: git writes a
 * typechange as a deletion and a creation of the same path.
 */
function mergeChangedFiles(
  changedFiles: readonly RevisionChangeFile[],
): Map<string, RevisionChangeFile> {
  const changedByFile = new Map<string, RevisionChangeFile>();
  for (const changed of changedFiles) {
    const known = changedByFile.get(changed.file);
    changedByFile.set(changed.file, {
      file: changed.file,
      addedRanges: [...(known?.addedRanges ?? []), ...changed.addedRanges],
      removedRanges: [
        ...(known?.removedRanges ?? []),
        ...changed.removedRanges,
      ],
    });
  }
  return changedByFile;
}

/** Each chunked file's sides; a file the diff does not change has no changed line. */
function indexSideLines(
  chunks: readonly ChunkRanges[],
  changedFiles: readonly RevisionChangeFile[],
): Map<string, Record<RangeSide, SideLines>> {
  const changedByFile = mergeChangedFiles(changedFiles);
  const sides = new Map<string, Record<RangeSide, SideLines>>();
  for (const [file, fileChunks] of groupByFile(chunks)) {
    const changed = changedByFile.get(file);
    sides.set(file, {
      addedRanges: buildSideLines(
        changed?.addedRanges ?? [],
        fileChunks.flatMap((chunk) => chunk.addedRanges),
      ),
      removedRanges: buildSideLines(
        changed?.removedRanges ?? [],
        fileChunks.flatMap((chunk) => chunk.removedRanges),
      ),
    });
  }
  return sides;
}

function isUnclaimedChange(range: LineRange, side: SideLines): boolean {
  for (let line = range.start; line <= range.end; line += 1) {
    const isUnclaimedChangedLine =
      side.changed.has(line) && !side.claimed.has(line);
    if (!isUnclaimedChangedLine) {
      return false;
    }
  }
  return true;
}

/**
 * The range one line over when it sits wholly on unchanged lines and exactly
 * one direction lands it wholly on changed lines no chunk claims.
 */
function findShiftedRange(
  range: LineRange,
  side: SideLines,
): LineRange | undefined {
  if (intersectRanges([range], side.changedRanges).length > 0) {
    return undefined;
  }
  const fits = LINE_SHIFTS.map((shift) => ({
    start: range.start + shift,
    end: range.end + shift,
  })).filter((candidate) => isUnclaimedChange(candidate, side));
  return fits.length === 1 ? fits[0] : undefined;
}

function alignSide(
  ranges: readonly LineRange[],
  side: SideLines,
  tally: AlignmentTally,
): LineRange[] {
  const aligned: LineRange[] = [];
  for (const range of ranges) {
    if (range.end < range.start) {
      continue;
    }
    const shifted = findShiftedRange(range, side);
    if (shifted !== undefined) {
      tally.shiftedRanges += 1;
      addLines(side.claimed, [shifted]);
      aligned.push(shifted);
      continue;
    }
    const kept = intersectRanges([range], side.changedRanges);
    tally.clippedLines += range.end - range.start + 1 - countLines(kept);
    aligned.push(...kept);
  }
  return aligned;
}

function reportAlignment(
  tally: AlignmentTally,
  warnings: WarningCollector,
): void {
  if (tally.shiftedRanges === 0 && tally.clippedLines === 0) {
    return;
  }
  warnings.report({
    kind: GenerationWarningKinds.RANGES_ALIGNED,
    message: `chunk ranges aligned to the diff: ${String(tally.shiftedRanges)} range(s) moved one line onto the change beside them, ${String(tally.clippedLines)} claimed line(s) off the changed lines clipped`,
    shiftedRanges: tally.shiftedRanges,
    clippedLines: tally.clippedLines,
  });
}

/**
 * Every model chunk's ranges on the diff's changed lines, before the snap
 * and the counts: a range one line off the change it meant moves onto it,
 * and every range is clipped to the changed lines, so chunks and the
 * unattributed remainder together claim each changed line exactly. A range
 * left with no line drops; the chunk stays, as one on a file with no
 * changed line does.
 */
export function alignChunkRanges<C extends ChunkRanges>(
  chunks: readonly C[],
  changedFiles: readonly RevisionChangeFile[],
  warnings: WarningCollector,
): C[] {
  const sides = indexSideLines(chunks, changedFiles);
  const tally: AlignmentTally = { shiftedRanges: 0, clippedLines: 0 };

  const aligned = chunks.map((chunk) => {
    const fileSides = sides.get(chunk.file);
    if (fileSides === undefined) {
      return chunk;
    }
    return {
      ...chunk,
      addedRanges: alignSide(chunk.addedRanges, fileSides.addedRanges, tally),
      removedRanges: alignSide(
        chunk.removedRanges,
        fileSides.removedRanges,
        tally,
      ),
    };
  });

  reportAlignment(tally, warnings);
  return aligned;
}
