import { DiffLineKinds } from "types/diff-lines";
import { HUNK_HEADER } from "../consts";
import {
  ExpansionDirections,
  type ExpansionEdge,
  type ExpansionGap,
  type ParsedDiffLine,
} from "../types";

interface NewSideAnchor {
  index: number;
  newLine: number;
}

/** Every edge a reader can expand from, in row order. */
export function findExpansionGaps(
  diff: readonly ParsedDiffLine[],
): ExpansionGap[] {
  const anchors = listNewSideAnchors(diff);
  const first = anchors[0];
  const last = anchors.at(-1);
  if (first === undefined || last === undefined) {
    return [];
  }

  const trail = traceOffsets(diff);
  const gaps: ExpansionGap[] = [];

  if (first.newLine > 1) {
    const header = diff[0]?.kind === DiffLineKinds.HUNK ? 0 : undefined;
    const runStart = findRunStart(diff, -1, header);
    const edge = { rowIndex: runStart, direction: ExpansionDirections.UP };
    const offset = readRunOffset(diff, runStart, trail);
    gaps.push(shapeGap(edge, 1, first.newLine - 1, offset));
  }

  gaps.push(...findInnerGaps(diff, anchors, trail));

  const tail = { rowIndex: diff.length, direction: ExpansionDirections.DOWN };
  gaps.push(
    shapeGap(
      tail,
      last.newLine + 1,
      undefined,
      readOffset(trail, diff.length - 1),
    ),
  );

  return gaps;
}

function findInnerGaps(
  diff: readonly ParsedDiffLine[],
  anchors: readonly NewSideAnchor[],
  trail: readonly number[],
): ExpansionGap[] {
  const gaps: ExpansionGap[] = [];

  for (let position = 1; position < anchors.length; position += 1) {
    const above = anchors[position - 1];
    const below = anchors[position];
    if (above === undefined || below === undefined) {
      continue;
    }
    if (below.newLine <= above.newLine + 1) {
      continue;
    }

    const header = findHeaderBetween(diff, above.index, below.index);
    const start = above.newLine + 1;
    const end = below.newLine - 1;
    const runStart = findRunStart(diff, above.index, header);
    const downIndex = header ?? runStart;
    const down = { rowIndex: downIndex, direction: ExpansionDirections.DOWN };
    const up = { rowIndex: runStart, direction: ExpansionDirections.UP };
    gaps.push(shapeGap(down, start, end, readOffset(trail, downIndex - 1)));
    gaps.push(shapeGap(up, start, end, readRunOffset(diff, runStart, trail)));
  }

  return gaps;
}

/**
 * The first row of the run below a gap, whatever its kind: the row after
 * the header, or, with no header, the first row after the run above that is
 * not a deletion continuing the run above's old numbering.
 */
function findRunStart(
  diff: readonly ParsedDiffLine[],
  aboveIndex: number,
  header: number | undefined,
): number {
  if (header !== undefined) {
    return header + 1;
  }
  let index = aboveIndex + 1;

  while (index < diff.length) {
    const row = diff[index];
    const previous = diff[index - 1];
    const continues =
      row?.kind === DiffLineKinds.DEL &&
      previous?.oldLine !== undefined &&
      row.oldLine === previous.oldLine + 1;
    if (!continues) {
      break;
    }
    index += 1;
  }

  return index;
}

/**
 * The offset in force at the first row of a run: the run's first row with
 * both numbers states it, walked back one per deletion and one per addition
 * in between. A run with no such row falls back on the trail.
 */
function readRunOffset(
  diff: readonly ParsedDiffLine[],
  runStart: number,
  trail: readonly number[],
): number {
  for (let index = runStart; index < diff.length; index += 1) {
    const row = diff[index];
    if (row === undefined || row.kind === DiffLineKinds.HUNK) {
      break;
    }
    const stated = readStatedOffset(row);
    if (stated === undefined) {
      continue;
    }
    let offset = stated;
    for (let back = index - 1; back >= runStart; back -= 1) {
      const crossed = diff[back];
      if (crossed?.kind === DiffLineKinds.ADD) {
        offset += 1;
      }
      if (crossed?.kind === DiffLineKinds.DEL) {
        offset -= 1;
      }
    }
    return offset;
  }

  return readOffset(trail, runStart - 1);
}

function shapeGap(
  edge: ExpansionEdge,
  start: number,
  end: number | undefined,
  offset: number,
): ExpansionGap {
  const gap: ExpansionGap = { edge, start, offset };
  if (end !== undefined) {
    gap.end = end;
  }

  return gap;
}

function listNewSideAnchors(diff: readonly ParsedDiffLine[]): NewSideAnchor[] {
  const anchors: NewSideAnchor[] = [];

  diff.forEach((row, index) => {
    if (row.newLine === undefined) {
      return;
    }
    if (row.kind === DiffLineKinds.HUNK) {
      return;
    }
    anchors.push({ index, newLine: row.newLine });
  });

  return anchors;
}

/**
 * `oldLine - newLine` in force after each row. A row carrying both numbers
 * STATES the offset and re-derives it: slicing drops whole runs of another
 * chunk's rows, so a running count alone drifts across every gap.
 */
function traceOffsets(diff: readonly ParsedDiffLine[]): number[] {
  const trail: number[] = [];
  let offset = 0;

  for (const row of diff) {
    const header = readHunkOffset(row);
    if (header !== undefined) {
      offset = header;
    }
    const stated = readStatedOffset(row);
    if (stated !== undefined) {
      offset = stated;
    }
    if (row.kind === DiffLineKinds.ADD) {
      offset -= 1;
    }
    if (row.kind === DiffLineKinds.DEL) {
      offset += 1;
    }
    trail.push(offset);
  }

  return trail;
}

function readStatedOffset(row: ParsedDiffLine): number | undefined {
  if (row.oldLine === undefined || row.newLine === undefined) {
    return undefined;
  }

  return row.oldLine - row.newLine;
}

function readHunkOffset(row: ParsedDiffLine): number | undefined {
  if (row.kind !== DiffLineKinds.HUNK) {
    return undefined;
  }
  const match = HUNK_HEADER.exec(row.content);
  const oldStart = match?.groups?.["oldStart"];
  const newStart = match?.groups?.["newStart"];
  if (oldStart === undefined || newStart === undefined) {
    return undefined;
  }

  return Number(oldStart) - Number(newStart);
}

function readOffset(trail: readonly number[], index: number): number {
  return trail[index] ?? 0;
}

function findHeaderBetween(
  diff: readonly ParsedDiffLine[],
  above: number,
  below: number,
): number | undefined {
  for (let index = above + 1; index < below; index += 1) {
    if (diff[index]?.kind === DiffLineKinds.HUNK) {
      return index;
    }
  }

  return undefined;
}
