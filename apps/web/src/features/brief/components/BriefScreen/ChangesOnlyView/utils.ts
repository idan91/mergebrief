import type { TFunction } from "i18next";

import { CommentSides, resolveChunkForLine } from "@web/features/review/utils";
import {
  type DiffLine,
  DiffLineKinds,
  DiffRowOrigins,
} from "@web/utils/diffTokens/types";

import type {
  Brief,
  BriefChunk,
  LengthViolation,
  LineRange,
  RevisionNarrativeChunk,
} from "../../../types";
import type { GuestRowOrigin } from "../../../utils/guest-rows";

/** A narrative card's rows and, per row, the owner row each came from; a gap note has none. */
export interface NarrativeRows {
  rows: DiffLine[];
  origins: (GuestRowOrigin | undefined)[];
  /** Removed lines the span diff supplied; the card's count note stands in when zero. */
  removedShown: number;
}

interface OriginRow {
  row: DiffLine;
  /** Absent for a removed line: the full brief holds no row for it. */
  origin: GuestRowOrigin | undefined;
  /** The row's seat in head numbering; a removed line takes the slot below the head line above it. */
  headSeat: number;
}

const HUNK_NEW_RANGE = /\+(\d+)(?:,(\d+))?/;

export function hasLengthViolations(
  ...artifacts: ({ lengthViolations?: LengthViolation[] } | null)[]
): boolean {
  return artifacts.some(
    (artifact) => (artifact?.lengthViolations ?? []).length > 0,
  );
}

export function isCodeRow(row: DiffLine): boolean {
  return (
    row.kind === DiffLineKinds.ADD ||
    row.kind === DiffLineKinds.DEL ||
    row.kind === DiffLineKinds.CTX
  );
}

function lineInRanges(line: number | undefined, ranges: LineRange[]): boolean {
  return (
    typeof line === "number" &&
    ranges.some((range) => line >= range.start && line <= range.end)
  );
}

export function countLines(ranges: LineRange[]): number {
  return ranges.reduce(
    (total, range) => total + (range.end - range.start + 1),
    0,
  );
}

/** Two code rows sit apart when the side they share skips a line between them. */
function countLinesBetween(previous: DiffLine, next: DiffLine): number {
  if (previous.newLine !== undefined && next.newLine !== undefined) {
    return next.newLine - previous.newLine - 1;
  }
  if (previous.oldLine !== undefined && next.oldLine !== undefined) {
    return next.oldLine - previous.oldLine - 1;
  }

  return 0;
}

function buildGapNote(t: TFunction, count: number): DiffLine {
  return {
    kind: DiffLineKinds.NOTE,
    content: t("brief.changes.linesNotShown", { count }),
    origin: DiffRowOrigins.GUEST,
  };
}

/**
 * A card's rows as guest rows, with a full-width note wherever two rows
 * that sit apart in the file would otherwise sit together, so the reader
 * sees the gap. The anchor refuses a range across it on its own, since a
 * guest anchor needs consecutive head lines.
 */
export function shapeGuestRows(
  rows: readonly DiffLine[],
  t: TFunction,
): DiffLine[] {
  const shaped: DiffLine[] = [];
  let previous: DiffLine | undefined;
  for (const row of rows) {
    if (!isCodeRow(row)) {
      continue;
    }
    const skipped =
      previous === undefined ? 0 : countLinesBetween(previous, row);
    if (skipped > 0) {
      shaped.push(buildGapNote(t, skipped));
    }
    shaped.push({ ...row, origin: DiffRowOrigins.GUEST });
    previous = row;
  }

  return shaped;
}

function compareByHeadSeat(left: OriginRow, right: OriginRow): number {
  if (left.headSeat !== right.headSeat) {
    return left.headSeat - right.headSeat;
  }
  const leftRemoved = left.row.kind === DiffLineKinds.DEL;
  const rightRemoved = right.row.kind === DiffLineKinds.DEL;
  if (leftRemoved !== rightRemoved) {
    return leftRemoved ? -1 : 1;
  }

  return (left.row.oldLine ?? 0) - (right.row.oldLine ?? 0);
}

function buildRowKey(row: DiffLine): string | undefined {
  if (row.kind === DiffLineKinds.DEL) {
    return row.oldLine === undefined ? undefined : `old:${String(row.oldLine)}`;
  }

  return row.newLine === undefined ? undefined : `new:${String(row.newLine)}`;
}

/**
 * One row per line. A chunk's sliced diff carries its neighbours' changed
 * lines as context, so two chunks side by side each hold the other's lines;
 * the chunk whose added ranges hold the line owns it.
 */
function pickOneRowPerLine(
  picked: readonly OriginRow[],
  chunksById: ReadonlyMap<string, BriefChunk>,
): OriginRow[] {
  const byLine = new Map<string, OriginRow>();
  for (const candidate of picked) {
    const key = buildRowKey(candidate.row);
    if (key === undefined) {
      continue;
    }
    const held = byLine.get(key);
    const heldOwns = held !== undefined && ownsLine(chunksById, held);
    if (held === undefined || (!heldOwns && ownsLine(chunksById, candidate))) {
      byLine.set(key, candidate);
    }
  }

  return [...byLine.values()];
}

function ownsLine(
  chunksById: ReadonlyMap<string, BriefChunk>,
  candidate: OriginRow,
): boolean {
  if (candidate.origin === undefined) {
    return false;
  }
  const chunk = chunksById.get(candidate.origin.chunkId);

  return (
    chunk !== undefined &&
    lineInRanges(candidate.row.newLine, chunk.addedRanges)
  );
}

/**
 * The head line above a hunk's first row. A hunk with no new lines names
 * the line the deletion follows; every other hunk names its first new line.
 */
function parseHunkHeadAbove(content: string): number {
  const match = HUNK_NEW_RANGE.exec(content);
  if (match?.[1] === undefined) {
    return 0;
  }
  const start = Number(match[1]);
  const count = match[2] === undefined ? 1 : Number(match[2]);

  return count === 0 ? start : start - 1;
}

/**
 * Head lines the card leaves out between two rows. A head row sits on its
 * line; a removed row sits between the head line above and its seat, so the
 * seat itself is hidden when the next row is not on it.
 */
function countHiddenLines(previous: OriginRow, next: OriginRow): number {
  const previousOnLine = previous.row.kind !== DiffLineKinds.DEL;
  const seatsBetween = next.headSeat - previous.headSeat;

  return previousOnLine ? seatsBetween - 1 : seatsBetween;
}

/**
 * The lines a revision removed, from the span diff: previous head to head,
 * the one diff whose old side matches the narrative's removed ranges. Each
 * takes the head seat right below the last head line the diff showed.
 */
function collectRemovedRows(
  chunk: RevisionNarrativeChunk,
  spanRows: readonly DiffLine[],
): OriginRow[] {
  const removed: OriginRow[] = [];
  let lastHead = 0;
  for (const row of spanRows) {
    if (row.kind === DiffLineKinds.HUNK) {
      lastHead = parseHunkHeadAbove(row.content);
      continue;
    }
    if (row.newLine !== undefined) {
      lastHead = row.newLine;
      continue;
    }
    const wanted =
      row.kind === DiffLineKinds.DEL &&
      lineInRanges(row.oldLine, chunk.removedRanges);
    if (wanted) {
      removed.push({ row, origin: undefined, headSeat: lastHead + 1 });
    }
  }

  return removed;
}

/**
 * The rows a narrative chunk names. Added and context rows come from the
 * full brief's head-coordinate diffs with the owner row each came from, so
 * a comment on the card keeps the owner's exact row id; removed lines come
 * from the span diff when a caller has it. Rows come out in head order with
 * a note over every gap.
 */
export function collectNarrativeRows(
  brief: Brief,
  chunk: RevisionNarrativeChunk,
  t: TFunction,
  spanRows: readonly DiffLine[] = [],
): NarrativeRows {
  const candidates: OriginRow[] = [];
  const fileChunks = chunksForFile(brief, chunk.file);
  for (const briefChunk of fileChunks) {
    briefChunk.diff?.forEach((row, index) => {
      const shown =
        (row.kind === DiffLineKinds.ADD || row.kind === DiffLineKinds.CTX) &&
        lineInRanges(row.newLine, chunk.addedRanges);
      if (shown && row.newLine !== undefined) {
        const origin = { chunkId: briefChunk.id, index };
        candidates.push({ row, origin, headSeat: row.newLine });
      }
    });
  }
  const removed = collectRemovedRows(chunk, spanRows);
  const chunksById = new Map(fileChunks.map((entry) => [entry.id, entry]));
  const picked = pickOneRowPerLine(
    candidates.concat(removed),
    chunksById,
  ).toSorted(compareByHeadSeat);

  const rows: DiffLine[] = [];
  const origins: (GuestRowOrigin | undefined)[] = [];
  let previous: OriginRow | undefined;
  for (const entry of picked) {
    const skipped =
      previous === undefined ? 0 : countHiddenLines(previous, entry);
    if (skipped > 0) {
      rows.push(buildGapNote(t, skipped));
      origins.push(undefined);
    }
    rows.push({ ...entry.row, origin: DiffRowOrigins.GUEST });
    origins.push(entry.origin);
    previous = entry;
  }

  return { rows, origins, removedShown: removed.length };
}

function chunksForFile(brief: Brief, file: string): BriefChunk[] {
  return brief.chunks.filter((chunk) => chunk.file === file);
}

/**
 * Narrative and delta chunks carry their own ids, so a card finds the Full
 * chunk it stands for by file and head lines.
 */
export function resolveCardOwnerChunkId(
  chunks: readonly BriefChunk[],
  file: string,
  addedRanges: readonly LineRange[],
  groupId?: string,
): string | undefined {
  const firstAdded = addedRanges
    .map((range) => range.start)
    .toSorted((left, right) => left - right)[0];
  if (firstAdded !== undefined) {
    return resolveChunkForLine(chunks, file, CommentSides.NEW, firstAdded)?.id;
  }

  const inFile = chunks.filter((chunk) => chunk.file === file);
  const inGroup = inFile.find((chunk) => chunk.changeGroupId === groupId);

  return (inGroup ?? inFile[0])?.id;
}
