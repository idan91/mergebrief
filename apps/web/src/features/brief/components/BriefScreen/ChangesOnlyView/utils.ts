import type { TFunction } from "i18next";

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
}

interface OriginRow {
  row: DiffLine;
  origin: GuestRowOrigin;
}

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

function compareByNewLine(left: OriginRow, right: OriginRow): number {
  return (left.row.newLine ?? 0) - (right.row.newLine ?? 0);
}

/**
 * One row per head line. A chunk's sliced diff carries its neighbours'
 * changed lines as context, so two chunks side by side each hold the
 * other's lines; the chunk whose added ranges hold the line owns it.
 */
function pickOneRowPerLine(
  picked: readonly OriginRow[],
  chunksById: ReadonlyMap<string, BriefChunk>,
): OriginRow[] {
  const byLine = new Map<number, OriginRow>();
  for (const candidate of picked) {
    const line = candidate.row.newLine;
    if (line === undefined) {
      continue;
    }
    const held = byLine.get(line);
    if (held === undefined || ownsLine(chunksById, candidate, line)) {
      const heldOwns = held !== undefined && ownsLine(chunksById, held, line);
      if (!heldOwns) {
        byLine.set(line, candidate);
      }
    }
  }

  return [...byLine.values()];
}

function ownsLine(
  chunksById: ReadonlyMap<string, BriefChunk>,
  candidate: OriginRow,
  line: number,
): boolean {
  const chunk = chunksById.get(candidate.origin.chunkId);

  return chunk !== undefined && lineInRanges(line, chunk.addedRanges);
}

/**
 * The added and context rows a narrative chunk names, pulled from the full
 * brief's head-coordinate diffs with the owner row each came from, so a
 * comment on the card keeps the owner's exact row id. Rows come out in
 * line order with a note over every gap. Removed lines have no row at head
 * (the brief holds base to head diffs, not previous head to head), so
 * callers summarize those as a count.
 */
export function collectNarrativeRows(
  brief: Brief,
  chunk: RevisionNarrativeChunk,
  t: TFunction,
): NarrativeRows {
  const candidates: OriginRow[] = [];
  const fileChunks = chunksForFile(brief, chunk.file);
  for (const briefChunk of fileChunks) {
    briefChunk.diff?.forEach((row, index) => {
      const shown =
        (row.kind === DiffLineKinds.ADD || row.kind === DiffLineKinds.CTX) &&
        lineInRanges(row.newLine, chunk.addedRanges);
      if (shown) {
        candidates.push({ row, origin: { chunkId: briefChunk.id, index } });
      }
    });
  }
  const chunksById = new Map(fileChunks.map((entry) => [entry.id, entry]));
  const picked = pickOneRowPerLine(candidates, chunksById).toSorted(
    compareByNewLine,
  );

  const rows: DiffLine[] = [];
  const origins: (GuestRowOrigin | undefined)[] = [];
  let previous: DiffLine | undefined;
  for (const { row, origin } of picked) {
    const skipped =
      previous === undefined ? 0 : countLinesBetween(previous, row);
    if (skipped > 0) {
      rows.push(buildGapNote(t, skipped));
      origins.push(undefined);
    }
    rows.push({ ...row, origin: DiffRowOrigins.GUEST });
    origins.push(origin);
    previous = row;
  }

  return { rows, origins };
}

function chunksForFile(brief: Brief, file: string): BriefChunk[] {
  return brief.chunks.filter((chunk) => chunk.file === file);
}
