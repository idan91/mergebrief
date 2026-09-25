/**
 * Range snap: the model attributes lines, and its ranges often stop at a
 * statement's first line and leave the indented tail (arguments, an object
 * literal, a closing bracket) to the unattributed remainder. Each attributed
 * range absorbs the remainder lines right after it while they sit deeper
 * than the range's opening line, in the same hunk, up to a cap. Pure and
 * language-agnostic: indentation and brackets only, no model call.
 */
import type { FileDiff } from "../diff/file-diff";
import {
  isAddedRow,
  isRemovedRow,
  parsePatchRows,
  type PatchRow,
} from "../diff/patch-rows";
import type { Chunk, LineRange } from "../types";

type ChunkRanges = Pick<Chunk, "file" | "addedRanges" | "removedRanges">;

/** Absorbing more than this per range would swallow a whole block on a bad guess. */
const SNAP_CAP = 10;
const TAB_COLUMNS = 4;
/** A line that starts by closing something: `}`, `}); // note`, `} as const`, `).map(`. */
const CLOSER_PREFIX = /^[)\]}]/;

/** Changed rows of a file keyed by their line number on one side. */
type SideRows = Map<number, PatchRow>;

interface FileRows {
  added: SideRows;
  removed: SideRows;
}

function indexFileRows(patch: string): FileRows {
  const added: SideRows = new Map();
  const removed: SideRows = new Map();
  for (const row of parsePatchRows(patch)) {
    if (isAddedRow(row) && row.newLine !== undefined) {
      added.set(row.newLine, row);
    }
    if (isRemovedRow(row) && row.oldLine !== undefined) {
      removed.set(row.oldLine, row);
    }
  }
  return { added, removed };
}

/** Leading whitespace in columns; a blank line reads as deeper than anything. */
function measureIndent(content: string): number {
  if (content.trim() === "") return Number.POSITIVE_INFINITY;
  let columns = 0;
  for (const char of content) {
    if (char === " ") columns += 1;
    else if (char === "\t") columns += TAB_COLUMNS;
    else break;
  }
  return columns;
}

/**
 * The balance after one line's brackets. A closer with nothing open belongs
 * to an outer scope and does not count, so `} else {` opens one.
 */
function tallyBrackets(content: string, balance: number): number {
  let next = balance;
  for (const char of content) {
    if (char === "(" || char === "[" || char === "{") next += 1;
    else if (char === ")" || char === "]" || char === "}") {
      if (next > 0) next -= 1;
    }
  }
  return next;
}

/** Brackets left open across the range's own lines. */
function countOpenBrackets(rows: SideRows, range: LineRange): number {
  let balance = 0;
  for (let line = range.start; line <= range.end; line += 1) {
    balance = tallyBrackets(rows.get(line)?.content ?? "", balance);
  }
  return balance;
}

/** The lines this pass has already given a chunk of the file. */
function takeClaimedLines(
  store: Map<string, Set<number>>,
  file: string,
): Set<number> {
  const set = store.get(file) ?? new Set<number>();
  store.set(file, set);
  return set;
}

function holdsLine(ranges: readonly LineRange[], line: number): boolean {
  return ranges.some((range) => line >= range.start && line <= range.end);
}

/**
 * The lines a range absorbs: remainder rows straight after it, in its hunk,
 * deeper than its opening line; a line at or above that indentation that
 * starts with a closer comes along only while the range has a bracket open,
 * and ends the tail unless it opens another (`} else {`, `).map(`).
 */
function resolveSnappedEnd(
  range: LineRange,
  rows: SideRows,
  isClaimed: (line: number) => boolean,
): number {
  // An inverted range is the model's mistake; loc derivation drops it and
  // the snap must not turn it into a counted one.
  if (range.end < range.start) return range.end;
  const opening = rows.get(range.start);
  const last = rows.get(range.end);
  if (opening === undefined || last === undefined) return range.end;
  const openIndent = measureIndent(opening.content);
  let balance = countOpenBrackets(rows, range);
  let end = range.end;

  for (let taken = 0; taken < SNAP_CAP; taken += 1) {
    const line = end + 1;
    const row = rows.get(line);
    if (row === undefined || row.hunk !== last.hunk || isClaimed(line)) break;
    if (measureIndent(row.content) > openIndent) {
      end = line;
      balance = tallyBrackets(row.content, balance);
      continue;
    }
    if (balance === 0 || !CLOSER_PREFIX.test(row.content.trim())) break;
    end = line;
    balance = tallyBrackets(row.content, balance);
    if (balance === 0) break;
  }

  return end;
}

/**
 * Every attributed range of every chunk, widened over the remainder tail it
 * opened. A line another chunk holds, or one this pass already gave away,
 * is never taken, so overlaps stay as the model produced them. Runs before
 * loc derivation so the overlap check and the remainder see final ranges.
 */
export function snapChunkRanges<C extends ChunkRanges>(
  chunks: readonly C[],
  fileDiffs: readonly FileDiff[],
): C[] {
  const rowsByFile = new Map(
    fileDiffs.map((fileDiff) => [fileDiff.file, indexFileRows(fileDiff.patch)]),
  );
  const claimedAdded = new Map<string, Set<number>>();
  const claimedRemoved = new Map<string, Set<number>>();
  const snapSide = (
    chunk: C,
    ranges: readonly LineRange[],
    side: keyof FileRows,
    store: Map<string, Set<number>>,
  ): LineRange[] => {
    const rows = rowsByFile.get(chunk.file)?.[side];
    if (rows === undefined) return [...ranges];
    const key = side === "added" ? "addedRanges" : "removedRanges";
    const others = chunks
      .filter(
        (candidate) => candidate !== chunk && candidate.file === chunk.file,
      )
      .flatMap((candidate) => candidate[key]);
    const taken = takeClaimedLines(store, chunk.file);
    const isClaimed = (line: number) =>
      taken.has(line) || holdsLine(others, line) || holdsLine(ranges, line);

    return ranges.map((range) => {
      const end = resolveSnappedEnd(range, rows, isClaimed);
      for (let line = range.end + 1; line <= end; line += 1) taken.add(line);
      return { start: range.start, end };
    });
  };

  return chunks.map((chunk) => ({
    ...chunk,
    addedRanges: snapSide(chunk, chunk.addedRanges, "added", claimedAdded),
    removedRanges: snapSide(
      chunk,
      chunk.removedRanges,
      "removed",
      claimedRemoved,
    ),
  }));
}
