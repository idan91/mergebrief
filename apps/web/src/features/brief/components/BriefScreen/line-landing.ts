// Where a line link lands, decided from the brief's own data before anything
// scrolls: the owner chunk, the row to find, and the hunk-edge read that
// brings a folded line into the rows.
import type { LineSide } from "@web/components/DiffRows/types";
import {
  CommentSides,
  type LineHashTarget,
  rowId,
} from "@web/features/review/utils";
import type { DiffLine } from "@web/utils/diffTokens/types";
import {
  type BriefChunk,
  type ExpansionGap,
  ExpansionDirections,
  type LineRange,
} from "../../types";
import { findExpansionGaps, formatExpansionKey } from "../../utils/expandRows";
import { resolveNearestLineOwner } from "../../utils/lineOwner";
import { LineLandingKinds, type LineLandingPlan } from "./types";

interface GapMatch {
  gap: ExpansionGap;
  newLines: number[];
}

function resolveLineSide(side: LineHashTarget["side"]): LineSide {
  return side === CommentSides.OLD ? "old" : "new";
}

function resolveLineOnSide(row: DiffLine, side: LineSide): number | undefined {
  return side === "old" ? row.oldLine : row.newLine;
}

function showsLine(rows: readonly DiffLine[], side: LineSide, line: number) {
  return rows.some((row) => resolveLineOnSide(row, side) === line);
}

/** How far the line sits from the nearest line the rows show on that side. */
function measureShownDistance(
  rows: readonly DiffLine[],
  side: LineSide,
  line: number,
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const shown = resolveLineOnSide(row, side);
    if (shown !== undefined) {
      nearest = Math.min(nearest, Math.abs(shown - line));
    }
  }
  return nearest;
}

/**
 * The chunk whose rows show the line, else the chunk whose shown rows on
 * that side come nearest, else the chunk whose changed ranges come nearest.
 */
function resolveOwner(
  fileChunks: readonly BriefChunk[],
  side: LineSide,
  line: number,
): BriefChunk | undefined {
  const shown = fileChunks.find(
    (chunk) => chunk.diff !== undefined && showsLine(chunk.diff, side, line),
  );
  if (shown !== undefined) {
    return shown;
  }
  let nearest: BriefChunk | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const chunk of fileChunks) {
    const distance = measureShownDistance(chunk.diff ?? [], side, line);
    if (distance < nearestDistance) {
      nearest = chunk;
      nearestDistance = distance;
    }
  }

  return nearest ?? resolveNearestLineOwner(side, line, fileChunks);
}

/** The gap holding every folded line, measured on the new side; old lines map through the edge's offset. */
function resolveGapForLines(
  gaps: readonly ExpansionGap[],
  side: LineSide,
  lines: readonly number[],
): GapMatch | undefined {
  let best: (GapMatch & { distance: number }) | undefined;

  for (const gap of gaps) {
    const newLines = lines.map((line) =>
      side === "old" ? line - gap.offset : line,
    );
    const inside = newLines.every(
      (newLine) =>
        newLine >= gap.from && (gap.to === undefined || newLine <= gap.to),
    );
    if (!inside) {
      continue;
    }
    const nearest = Math.min(...newLines);
    const farthest = Math.max(...newLines);
    const distance =
      gap.edge.direction === ExpansionDirections.UP
        ? (gap.to ?? nearest) - nearest
        : farthest - gap.from;
    if (best === undefined || distance < best.distance) {
      best = { gap, newLines, distance };
    }
  }

  return best;
}

/** From the edge to the far end of the folded lines, so the whole range shows. */
function shapeReadRange(match: GapMatch): LineRange {
  const nearest = Math.min(...match.newLines);
  const farthest = Math.max(...match.newLines);
  if (match.gap.edge.direction === ExpansionDirections.UP) {
    return { start: nearest, end: match.gap.to ?? farthest };
  }

  return { start: match.gap.from, end: farthest };
}

/**
 * The owner is the chunk that shows the range's first line on its side, or
 * the nearest one. A range the owner's rows already show lands directly;
 * folded lines land after the nearer edge reads from that edge to the far
 * end of the range, or to the first line alone when the ends fold into
 * different gaps. While the file's rows are still on their way the plan is
 * pending; once they have settled without arriving, the owner's card is
 * the landing.
 */
export function planLineLanding(
  chunks: readonly BriefChunk[],
  target: LineHashTarget,
  rowsSettled = true,
): LineLandingPlan {
  const startSide = resolveLineSide(target.startSide ?? target.side);
  const line = target.startLine;
  const fileChunks = chunks.filter((chunk) => chunk.file === target.file);
  if (fileChunks.length === 0) {
    return { kind: LineLandingKinds.MISS };
  }
  if (fileChunks.every((chunk) => chunk.diff === undefined)) {
    if (!rowsSettled) {
      return { kind: LineLandingKinds.PENDING };
    }
    const chunk =
      resolveNearestLineOwner(startSide, line, fileChunks) ?? fileChunks[0];
    return chunk === undefined
      ? { kind: LineLandingKinds.MISS }
      : { kind: LineLandingKinds.CARD, chunk };
  }
  const owner = resolveOwner(fileChunks, startSide, line);
  if (owner === undefined) {
    return { kind: LineLandingKinds.MISS };
  }
  const rows = owner.diff ?? [];
  const row = { side: startSide, line };
  const sameSide = startSide === resolveLineSide(target.side);
  const wanted = sameSide ? [line, target.endLine] : [line];
  const folded = wanted.filter(
    (wantedLine) => !showsLine(rows, startSide, wantedLine),
  );
  if (folded.length === 0) {
    return { kind: LineLandingKinds.LAND, chunk: owner, row };
  }

  const gaps = findExpansionGaps(rows);
  const match =
    resolveGapForLines(gaps, startSide, folded) ??
    resolveGapForLines(gaps, startSide, folded.slice(0, 1));
  if (match === undefined) {
    return { kind: LineLandingKinds.MISS };
  }

  return {
    kind: LineLandingKinds.LAND,
    chunk: owner,
    row,
    read: {
      edgeKey: formatExpansionKey(owner.id, match.gap.edge),
      direction: match.gap.edge.direction,
      range: shapeReadRange(match),
      coversStart: folded.includes(line),
    },
  };
}

/** Row ids for the rows the chunk's own diff shows in the range; none for folded ones. */
export function collectSelectionRowIds(
  chunk: BriefChunk,
  target: LineHashTarget,
): string[] {
  const rows = chunk.diff ?? [];
  const startSide = resolveLineSide(target.startSide ?? target.side);
  const endSide = resolveLineSide(target.side);
  if (startSide !== endSide) {
    return [];
  }
  const ids: string[] = [];
  rows.forEach((row, index) => {
    const line = resolveLineOnSide(row, endSide);
    if (line === undefined) {
      return;
    }
    if (line >= target.startLine && line <= target.endLine) {
      ids.push(rowId(chunk.id, index));
    }
  });

  return ids;
}
