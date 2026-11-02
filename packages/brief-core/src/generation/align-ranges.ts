import type { FileDiff } from "../diff/file-diff";
import type { RevisionChangeFile } from "../diff/revchanges";
import type { Chunk, LineRange } from "../types";
import { countLines, intersectRanges, mergeChangedFiles } from "./loc";
import { snapChunkRanges } from "./snap-ranges";
import {
  GenerationWarningKinds,
  type WarningCollector,
} from "./warnings/types";

type ChunkRanges = Pick<Chunk, "file" | "addedRanges" | "removedRanges">;
type RangeSide = "addedRanges" | "removedRanges";

/** The one-line moves tried for a range sitting wholly off the changed lines. */
const LINE_SHIFTS = [-1, 1] as const;
type LineShift = (typeof LINE_SHIFTS)[number];

/** Fewest one-way shifts on a file side that decide which way its ties move. */
const MIN_UNANIMOUS_SHIFTS = 2;

interface ShiftFit {
  shift: LineShift;
  range: LineRange;
}

/** A range both one-line moves fit, held empty in its chunk until pass 2. */
interface PendingTie {
  range: LineRange;
  /** The tie's place among its chunk's aligned ranges, filled if it moves. */
  slot: LineRange[];
}

/**
 * One file side's changed lines and those any chunk claims, both bounded by
 * the diff, with the shifts and ties pass 1 found on it in chunk order.
 */
interface SideLines {
  changedRanges: LineRange[];
  changed: ReadonlySet<number>;
  claimed: Set<number>;
  shifts: LineShift[];
  ties: PendingTie[];
}

type ChunkSlots = Record<RangeSide, LineRange[][]>;

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
  return { changedRanges, changed, claimed, shifts: [], ties: [] };
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

/** Each chunked file's sides; a file the diff does not change has no changed line. */
function indexSideLines(
  chunks: readonly ChunkRanges[],
  changedFiles: readonly RevisionChangeFile[],
): Map<string, Record<RangeSide, SideLines>> {
  const changedByFile = mergeChangedFiles(changedFiles);
  const sides = new Map<string, Record<RangeSide, SideLines>>();
  for (const [file, fileChunks] of groupByFile(chunks)) {
    const changed = changedByFile.get(file);
    const addedClaims = fileChunks.flatMap((chunk) => chunk.addedRanges);
    const removedClaims = fileChunks.flatMap((chunk) => chunk.removedRanges);
    sides.set(file, {
      addedRanges: buildSideLines(changed?.addedRanges ?? [], addedClaims),
      removedRanges: buildSideLines(
        changed?.removedRanges ?? [],
        removedClaims,
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

function shiftRange(range: LineRange, shift: LineShift): LineRange {
  return { start: range.start + shift, end: range.end + shift };
}

/**
 * The one-line moves that land a range sitting wholly on unchanged lines
 * wholly on changed lines no chunk claims.
 */
function listShiftFits(range: LineRange, side: SideLines): ShiftFit[] {
  if (intersectRanges([range], side.changedRanges).length > 0) {
    return [];
  }
  return LINE_SHIFTS.map((shift) => ({
    shift,
    range: shiftRange(range, shift),
  })).filter((fit) => isUnclaimedChange(fit.range, side));
}

function claimShiftedRange(
  range: LineRange,
  side: SideLines,
  tally: AlignmentTally,
): void {
  tally.shiftedRanges += 1;
  addLines(side.claimed, [range]);
}

/**
 * Pass 1, one range: a single fit moves and counts as the side's evidence,
 * a tie waits in an empty slot, anything else clips to the changed lines.
 */
function placeRange(
  range: LineRange,
  side: SideLines,
  tally: AlignmentTally,
): LineRange[] {
  const fits = listShiftFits(range, side);
  if (fits.length === LINE_SHIFTS.length) {
    const slot: LineRange[] = [];
    side.ties.push({ range, slot });
    return slot;
  }

  const [fit] = fits;
  if (fit !== undefined) {
    claimShiftedRange(fit.range, side, tally);
    side.shifts.push(fit.shift);
    return [fit.range];
  }

  const kept = intersectRanges([range], side.changedRanges);
  tally.clippedLines += range.end - range.start + 1 - countLines(kept);
  return kept;
}

function placeSide(
  ranges: readonly LineRange[],
  side: SideLines,
  tally: AlignmentTally,
): LineRange[][] {
  return ranges
    .filter((range) => range.end >= range.start)
    .map((range) => placeRange(range, side, tally));
}

/** The one direction every pass-1 shift on the side took, given enough of them. */
function findUnanimousShift(side: SideLines): LineShift | undefined {
  const [first] = side.shifts;
  const isUnanimous = side.shifts.every((shift) => shift === first);
  if (!isUnanimous || side.shifts.length < MIN_UNANIMOUS_SHIFTS) {
    return undefined;
  }
  return first;
}

function findTieMove(
  range: LineRange,
  shift: LineShift | undefined,
  side: SideLines,
): LineRange | undefined {
  if (shift === undefined) {
    return undefined;
  }
  const moved = shiftRange(range, shift);
  return isUnclaimedChange(moved, side) ? moved : undefined;
}

/**
 * Pass 2, in chunk order: each tie moves the side's unanimous way when that
 * still lands on changed lines no chunk claims, and clips otherwise.
 */
function breakTies(side: SideLines, tally: AlignmentTally): void {
  const shift = findUnanimousShift(side);
  for (const tie of side.ties) {
    const moved = findTieMove(tie.range, shift, side);
    if (moved === undefined) {
      tally.clippedLines += tie.range.end - tie.range.start + 1;
      continue;
    }
    claimShiftedRange(moved, side, tally);
    tie.slot.push(moved);
  }
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
 * both one-line moves fit takes the way every unambiguous move on its file
 * side went, at least two of them, and clips otherwise. A range left with
 * no line drops; the chunk stays, as one on a file with no changed line does.
 */
export function alignChunkRanges<C extends ChunkRanges>(
  chunks: readonly C[],
  changedFiles: readonly RevisionChangeFile[],
  warnings: WarningCollector,
): C[] {
  const sides = indexSideLines(chunks, changedFiles);
  const tally: AlignmentTally = { shiftedRanges: 0, clippedLines: 0 };

  const placed = chunks.map((chunk) => {
    const fileSides = sides.get(chunk.file);
    if (fileSides === undefined) {
      return { chunk, slots: undefined };
    }
    const slots: ChunkSlots = {
      addedRanges: placeSide(chunk.addedRanges, fileSides.addedRanges, tally),
      removedRanges: placeSide(
        chunk.removedRanges,
        fileSides.removedRanges,
        tally,
      ),
    };
    return { chunk, slots };
  });
  for (const fileSides of sides.values()) {
    breakTies(fileSides.addedRanges, tally);
    breakTies(fileSides.removedRanges, tally);
  }

  reportAlignment(tally, warnings);
  return placed.map(({ chunk, slots }) => {
    if (slots === undefined) {
      return chunk;
    }
    return {
      ...chunk,
      addedRanges: slots.addedRanges.flat(),
      removedRanges: slots.removedRanges.flat(),
    };
  });
}

/** The Brief's range order over one diff: align to the changed lines, then snap. */
export function alignAndSnapChunkRanges<C extends ChunkRanges>(
  chunks: readonly C[],
  fileDiffs: readonly FileDiff[],
  changedFiles: readonly RevisionChangeFile[],
  warnings: WarningCollector,
): C[] {
  const aligned = alignChunkRanges(chunks, changedFiles, warnings);
  return snapChunkRanges(aligned, fileDiffs);
}
