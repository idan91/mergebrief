import {
  type DiffLine,
  type DiffLineKind,
  DiffLineKinds,
  DiffRowOrigins,
} from "@web/utils/diffTokens/types";
import type { LineRange } from "brief-core/types";
import { type DiffView, DiffViews } from "@web/components/DiffRows/types";
import type {
  CollectExpansionRowsParams,
  FileRangeSlice,
  ExpansionRowSources,
} from "./types";

const HUNK_HEADER =
  /^@@ -(?<oldStart>\d+)(?:,\d+)? \+(?<newStart>\d+)(?:,\d+)? @@/;

/** What a pass over a range's rows does with each one. */
interface ExpansionRowVisitor {
  /** A row the file's diff already has, shown as expanded context. */
  onFileRow: (row: DiffLine) => void;
  /** A line no hunk covers, from the file read; `oldOffset` turns its new line into its old one. */
  onReadLine: (line: number, oldOffset: number) => void;
}

/**
 * The rows one expansion range shows, in file order: a line a hunk covers
 * comes from the diff itself, a line no hunk covers from the file-range
 * read, and a deletion rides with the new-side line it follows. A deletion
 * that follows the line just above the gap belongs to the first read into
 * that gap, since no range will ever cover its anchor.
 */
export function collectExpansionRows(
  params: CollectExpansionRowsParams,
): DiffLine[] {
  const rows: DiffLine[] = [];
  visitExpansionRows(params, {
    onFileRow: (row) => {
      rows.push({ ...row, origin: DiffRowOrigins.EXPANDED });
    },
    onReadLine: (line, oldOffset) => {
      const content = readSliceLine(params.slice, line);
      if (content === undefined) {
        return;
      }
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
 * How many rows the range would show, without building them: the height
 * model asks this for every expanded card on each pass. Split rows pair a
 * deletion run with the addition run after it, as `countSplitRows` does.
 */
export function countExpansionRows(
  params: ExpansionRowSources,
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
      if (adds > 0) {
        flush();
      }
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
  visitExpansionRows(params, {
    onFileRow: (row) => tally(row.kind),
    onReadLine: () => tally(DiffLineKinds.CTX),
  });
  flush();

  return rows;
}

/**
 * One pass over the rows a range shows, in file order. Two sources
 * interleave: the file's diff rows where a hunk covers a line, and the range
 * read for every line between hunks. A deletion hangs off the new-side line
 * above it, so it shows when that line is in the range, or when it hangs
 * off the line just above the gap and this range is the first read into
 * that gap.
 */
function visitExpansionRows(
  sources: ExpansionRowSources,
  visitor: ExpansionRowVisitor,
): void {
  const { fileRows, range, gapStart, base } = sources;
  const carried = collectCarriedDeletions(base);
  let oldOffset = 0;
  let anchor: number | undefined;
  let nextReadLine = range.start;

  const fillFromRead = (upTo: number): void => {
    const last = Math.min(upTo, range.end);
    while (nextReadLine <= last) {
      visitor.onReadLine(nextReadLine, oldOffset);
      nextReadLine += 1;
    }
  };

  for (const row of fileRows) {
    if (row.kind === DiffLineKinds.HUNK) {
      const header = readHunkHeader(row);
      if (header === undefined) {
        continue;
      }
      if (header.newStart > range.end) {
        break;
      }

      fillFromRead(header.newStart - 1);
      oldOffset = header.oldStart - header.newStart;
      anchor = header.newStart - 1;
      continue;
    }

    if (row.kind === DiffLineKinds.DEL) {
      const anchorInRange =
        anchor !== undefined && anchor >= range.start && anchor <= range.end;
      const anchorAboveGap =
        anchor === gapStart - 1 && range.start === gapStart;
      const shown =
        (anchorInRange || anchorAboveGap) &&
        row.oldLine !== undefined &&
        !carried.has(row.oldLine);

      if (shown) {
        visitor.onFileRow(row);
      }
      oldOffset += 1;
      continue;
    }

    if (row.newLine === undefined) {
      continue;
    }
    if (row.newLine > range.end) {
      break;
    }

    fillFromRead(row.newLine - 1);
    if (row.newLine >= range.start) {
      visitor.onFileRow(row);
      nextReadLine = row.newLine + 1;
    }
    anchor = row.newLine;
    oldOffset = readOffsetAfter(row, oldOffset);
  }
  fillFromRead(range.end);
}

/** Whether every line of the range has a row in the file's diff. */
export function isExpansionCovered(
  fileRows: readonly DiffLine[],
  range: LineRange,
): boolean {
  const covered = new Set<number>();
  for (const row of fileRows) {
    if (row.newLine === undefined || row.kind === DiffLineKinds.HUNK) {
      continue;
    }
    const inRange = row.newLine >= range.start && row.newLine <= range.end;
    if (inRange) {
      covered.add(row.newLine);
    }
  }

  const lineCount = range.end - range.start + 1;
  return covered.size === lineCount;
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

function readSliceLine(
  slice: FileRangeSlice,
  line: number,
): string | undefined {
  const outsideSlice = line < slice.start || line > slice.end;
  if (outsideSlice) {
    return undefined;
  }

  const index = line - slice.start;
  return slice.lines[index];
}

function readOffsetAfter(row: DiffLine, offset: number): number {
  if (row.kind === DiffLineKinds.ADD) {
    return offset - 1;
  }
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
  if (oldStart === undefined || newStart === undefined) {
    return undefined;
  }

  return { oldStart: Number(oldStart), newStart: Number(newStart) };
}
