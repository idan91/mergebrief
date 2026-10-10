// Where a line link scrolls to, decided from the brief's own data before anything
// scrolls: the chunk it names, the row to find, and the hunk-edge read that
// brings a folded line into the rows.
import type { LineRange } from "brief-core/types";
import { type LineLinkTarget, rowId } from "@web/features/review/utils";
import { type DiffLine } from "@web/utils/diffTokens/types";
import { type BriefChunk } from "../../../../model/types";
import {
  type ExpansionGap,
  ExpansionDirections,
} from "../../../../model/expansion/types";
import {
  findExpansionGaps,
  formatExpansionKey,
} from "../../../../model/expansion/gaps";
import { LineLinkPlanKinds, type LineLinkPlan } from "../types";
import { DiffSides, type DiffSide } from "types/comments";

interface GapMatch {
  gap: ExpansionGap;
  newLines: number[];
}

function resolveLineOnSide(row: DiffLine, side: DiffSide): number | undefined {
  return side === DiffSides.OLD ? row.oldLine : row.newLine;
}

function showsLine(rows: readonly DiffLine[], side: DiffSide, line: number) {
  return rows.some((row) => resolveLineOnSide(row, side) === line);
}

/** The gap holding every folded line, measured on the new side; old lines map through the edge's offset. */
function resolveGapForLines(
  gaps: readonly ExpansionGap[],
  side: DiffSide,
  lines: readonly number[],
): GapMatch | undefined {
  let best: (GapMatch & { distance: number }) | undefined;

  for (const gap of gaps) {
    const newLines = lines.map((line) =>
      side === DiffSides.OLD ? line - gap.offset : line,
    );
    const inside = newLines.every((newLine) => {
      const inGap =
        newLine >= gap.start && (gap.end === undefined || newLine <= gap.end);
      return inGap;
    });
    if (!inside) {
      continue;
    }
    const nearest = Math.min(...newLines);
    const farthest = Math.max(...newLines);
    const distance =
      gap.edge.direction === ExpansionDirections.UP
        ? (gap.end ?? nearest) - nearest
        : farthest - gap.start;
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
    return { start: nearest, end: match.gap.end ?? farthest };
  }

  return { start: match.gap.start, end: farthest };
}

/**
 * The link's chunk is the target. A range its rows already show is the
 * target directly; folded lines become it after the nearer edge reads from that edge
 * to the far end of the range, or to the first line alone when the ends
 * fold into different gaps. While the chunk's rows are still on their way
 * the plan is pending; once they have settled without arriving, the card
 * is the target.
 */
export function planLineLink(
  chunks: readonly BriefChunk[],
  target: LineLinkTarget,
  rowsSettled = true,
): LineLinkPlan {
  const startSide = target.startSide ?? target.side;
  const line = target.startLine;
  const owner = chunks.find((chunk) => chunk.id === target.chunkId);
  if (owner === undefined) {
    return { kind: LineLinkPlanKinds.MISS };
  }
  if (owner.diff === undefined) {
    return rowsSettled
      ? { kind: LineLinkPlanKinds.CARD, chunk: owner }
      : { kind: LineLinkPlanKinds.PENDING };
  }
  const rows = owner.diff;
  const row = { side: startSide, line };
  const sameSide = startSide === target.side;
  const wanted = sameSide ? [line, target.endLine] : [line];
  const folded = wanted.filter(
    (wantedLine) => !showsLine(rows, startSide, wantedLine),
  );
  if (folded.length === 0) {
    return { kind: LineLinkPlanKinds.ROW, chunk: owner, row };
  }

  const gaps = findExpansionGaps(rows);
  const match =
    resolveGapForLines(gaps, startSide, folded) ??
    resolveGapForLines(gaps, startSide, folded.slice(0, 1));
  if (match === undefined) {
    return { kind: LineLinkPlanKinds.MISS };
  }

  return {
    kind: LineLinkPlanKinds.ROW,
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
  target: LineLinkTarget,
): string[] {
  const rows = chunk.diff ?? [];
  const startSide = target.startSide ?? target.side;
  const endSide = target.side;
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
