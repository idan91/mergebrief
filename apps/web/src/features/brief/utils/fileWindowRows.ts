import {
  type DiffLine,
  type DiffLineKind,
  DiffLineKinds,
  DiffRowOrigins,
} from "@web/utils/diffTokens/types";
import { type DiffView, DiffViews } from "@web/components/DiffRows/types";
import type {
  CollectWindowRowsParams,
  ExpansionWindow,
  FileRangeSlice,
  WindowRowSources,
} from "../types";

const HUNK_HEADER =
  /^@@ -(?<oldStart>\d+)(?:,\d+)? \+(?<newStart>\d+)(?:,\d+)? @@/;

/** What a pass over a window's rows does with each one. */
interface WindowRowVisitor {
  /** A row the file's diff already has, shown as expanded context. */
  onFileRow: (row: DiffLine) => void;
  /** A line no hunk covers; `oldOffset` turns its new line into its old one. */
  onRangeLine: (line: number, oldOffset: number) => void;
}

/**
 * The rows one expansion window shows, in file order: a line a hunk covers
 * comes from the diff itself, a line no hunk covers from the file-range
 * read, and a deletion rides with the new-side line it follows. A deletion
 * that follows the line just above the hole belongs to the first read into
 * that hole, since no window will ever cover its anchor.
 */
export function collectWindowRows(params: CollectWindowRowsParams): DiffLine[] {
  const rows: DiffLine[] = [];
  visitWindowRows(params, {
    onFileRow: (row) => {
      rows.push({ ...row, origin: DiffRowOrigins.EXPANDED });
    },
    onRangeLine: (line, oldOffset) => {
      const content = readRangeLine(params.range, line);
      if (content === undefined) return;
      rows.push({
        kind: DiffLineKinds.CTX,
        origin: DiffRowOrigins.EXPANDED,
        content,
        oldLine: line + oldOffset,
        newLine: line,
      });
    },
  });

  return rows;
}

/**
 * How many rows the window would show, without building them: the height
 * model asks this for every expanded card on each pass. Split rows pair a
 * deletion run with the addition run after it, as `countSplitRows` does.
 */
export function countWindowRows(
  params: WindowRowSources,
  view: DiffView,
): number {
  let rows = 0;
  let dels = 0;
  let adds = 0;
  const flush = (): void => {
    rows += view === DiffViews.SPLIT ? Math.max(dels, adds) : dels + adds;
    dels = 0;
    adds = 0;
  };
  const tally = (kind: DiffLineKind): void => {
    if (kind === DiffLineKinds.DEL) {
      if (adds > 0) flush();
      dels += 1;
      return;
    }
    if (kind === DiffLineKinds.ADD) {
      adds += 1;
      return;
    }
    flush();
    rows += 1;
  };
  visitWindowRows(params, {
    onFileRow: (row) => tally(row.kind),
    onRangeLine: () => tally(DiffLineKinds.CTX),
  });
  flush();

  return rows;
}

/**
 * One pass over the rows a window shows, in file order. Two sources
 * interleave: the file's diff rows where a hunk covers a line, and the range
 * read for every line between hunks. A deletion hangs off the new-side line
 * above it, so it shows when that line is in the window, or when it hangs
 * off the line just above the hole and this window is the first read into
 * that hole.
 */
function visitWindowRows(
  sources: WindowRowSources,
  visitor: WindowRowVisitor,
): void {
  const { fileRows, window, holeStart, base } = sources;
  const carried = collectCarriedDeletions(base);
  let oldOffset = 0;
  let anchor: number | undefined;
  let nextRangeLine = window.from;

  const fillFromRange = (upTo: number): void => {
    const last = Math.min(upTo, window.to);
    while (nextRangeLine <= last) {
      visitor.onRangeLine(nextRangeLine, oldOffset);
      nextRangeLine += 1;
    }
  };

  for (const row of fileRows) {
    if (row.kind === DiffLineKinds.HUNK) {
      const header = readHunkHeader(row);
      if (header === undefined) continue;
      if (header.newStart > window.to) break;

      fillFromRange(header.newStart - 1);
      oldOffset = header.oldStart - header.newStart;
      anchor = header.newStart - 1;
      continue;
    }

    if (row.kind === DiffLineKinds.DEL) {
      const anchorInWindow =
        anchor !== undefined && anchor >= window.from && anchor <= window.to;
      const anchorAboveHole =
        anchor === holeStart - 1 && window.from === holeStart;
      const shown =
        (anchorInWindow || anchorAboveHole) &&
        row.oldLine !== undefined &&
        !carried.has(row.oldLine);

      if (shown) visitor.onFileRow(row);
      oldOffset += 1;
      continue;
    }

    if (row.newLine === undefined) continue;
    if (row.newLine > window.to) break;

    fillFromRange(row.newLine - 1);
    if (row.newLine >= window.from) {
      visitor.onFileRow(row);
      nextRangeLine = row.newLine + 1;
    }
    anchor = row.newLine;
    oldOffset = readOffsetAfter(row, oldOffset);
  }
  fillFromRange(window.to);
}

/** Whether every line of the window has a row in the file's diff. */
export function isWindowCovered(
  fileRows: readonly DiffLine[],
  window: ExpansionWindow,
): boolean {
  const covered = new Set<number>();
  for (const row of fileRows) {
    if (row.newLine === undefined || row.kind === DiffLineKinds.HUNK) continue;
    if (row.newLine >= window.from && row.newLine <= window.to) {
      covered.add(row.newLine);
    }
  }

  return covered.size === window.to - window.from + 1;
}

function collectCarriedDeletions(base: readonly DiffLine[]): Set<number> {
  const carried = new Set<number>();
  for (const row of base) {
    if (row.kind === DiffLineKinds.DEL && row.oldLine !== undefined) {
      carried.add(row.oldLine);
    }
  }

  return carried;
}

function readRangeLine(
  range: FileRangeSlice,
  line: number,
): string | undefined {
  if (line < range.from || line > range.to) return undefined;

  return range.lines[line - range.from];
}

function readOffsetAfter(row: DiffLine, offset: number): number {
  if (row.kind === DiffLineKinds.ADD) return offset - 1;
  if (row.oldLine !== undefined && row.newLine !== undefined) {
    return row.oldLine - row.newLine;
  }

  return offset;
}

function readHunkHeader(
  row: DiffLine,
): { oldStart: number; newStart: number } | undefined {
  const match = HUNK_HEADER.exec(row.content);
  const oldStart = match?.groups?.["oldStart"];
  const newStart = match?.groups?.["newStart"];
  if (oldStart === undefined || newStart === undefined) return undefined;

  return { oldStart: Number(oldStart), newStart: Number(newStart) };
}
