import {
  RowRunKinds,
  readRowRuns,
  type ChunkLayoutCounts,
  type RowRun,
} from "brief-core/chunk-layout";
import { DiffViews, type DiffView } from "@web/components/DiffRows/types";
import { countReservedLines } from "../../reading/chunk-height-model";
import { HEADER_COLUMNS, MAX_SKELETON_ROWS } from "./consts";
import {
  makeCodeRow,
  makeNoteRow,
  makePaddingRow,
  makePlanContext,
  type PlanContext,
  type RowKinds,
} from "./row-shape";
import {
  SkeletonInks,
  SkeletonRowTypes,
  SkeletonSideKinds,
  type SkeletonPlan,
  type PlannedRow,
} from "./types";

interface PlanState {
  rows: PlannedRow[];
  lines: number;
  /** Code rows drawn that took a width from the histogram. */
  widthIndex: number;
  hunkLanes: number;
}

/**
 * The rows a card's skeleton draws, line for line the ones the height model
 * reserves. Stored row runs that agree with the counts places hunk bands,
 * expand rows and every added, removed and one-sided row where the code
 * will draw them; without one every row is context, so no colour is guessed.
 */
export function planSkeletonRows(
  counts: ChunkLayoutCounts,
  view: DiffView,
): SkeletonPlan {
  const storedRuns = readMatchingRowRuns(counts);
  const runs = storedRuns ?? synthesizeRuns(counts, view);
  const context = makePlanContext(counts, view, countNoteRows(runs));
  const state: PlanState = { rows: [], lines: 0, widthIndex: 0, hunkLanes: 0 };
  const reservedLines = countReservedLines(counts, view);

  drawRuns(state, runs, context);
  const filled = reservedLines > MAX_SKELETON_ROWS;
  if (!filled && counts.rows > 0) {
    padContextRows(state, reservedLines, context.split);
  }

  return {
    rows: state.rows,
    filled,
    ink: storedRuns === undefined ? SkeletonInks.NEUTRAL : SkeletonInks.MIRROR,
  };
}

/** The stored row runs when they add up to the counts; any disagreement draws neutral. */
function readMatchingRowRuns(counts: ChunkLayoutCounts): RowRun[] | undefined {
  if (counts.rowRuns === undefined) {
    return undefined;
  }
  const runs = readRowRuns(counts.rowRuns);
  const totals = { rows: 0, hunks: 0, expands: 0 };
  for (const run of runs) {
    if (run.kind === RowRunKinds.EXPAND) {
      totals.expands += run.length;
      continue;
    }
    totals.rows += run.length;
    if (run.kind === RowRunKinds.HUNK) {
      totals.hunks += run.length;
    }
  }
  const agrees =
    totals.rows === counts.rows &&
    totals.hunks === counts.hunkRows &&
    totals.expands === counts.expandRows;

  return agrees ? runs : undefined;
}

/** A card with no rowRuns: its hunks spread evenly, context between them, its expand rows last. */
function synthesizeRuns(counts: ChunkLayoutCounts, view: DiffView): RowRun[] {
  const paintedRows = view === DiffViews.SPLIT ? counts.splitRows : counts.rows;
  const context = Math.max(paintedRows - counts.hunkRows, 0);
  const segments = Math.max(counts.hunkRows, 1);
  const drawnSegments = Math.min(segments, MAX_SKELETON_ROWS);
  const runs: RowRun[] = [];

  for (let segment = 0; segment < drawnSegments; segment += 1) {
    if (counts.hunkRows > 0) {
      runs.push({ kind: RowRunKinds.HUNK, length: 1 });
    }
    const share = computeShare(context, segments, segment);
    if (share > 0) {
      runs.push({ kind: RowRunKinds.CONTEXT, length: share });
    }
  }
  if (counts.expandRows > 0) {
    runs.push({ kind: RowRunKinds.EXPAND, length: counts.expandRows });
  }

  return runs;
}

function drawRuns(
  state: PlanState,
  runs: readonly RowRun[],
  context: PlanContext,
): void {
  let index = 0;
  while (index < runs.length && hasRoom(state)) {
    const run = runs[index];
    if (run === undefined) {
      break;
    }
    if (context.split && run.kind === RowRunKinds.REMOVED) {
      index = drawSplitChange(state, runs, index, context);
      continue;
    }
    drawRun(state, run, context);
    index += 1;
  }
}

/**
 * A removed run and the added run after it zip row for row in the split
 * view, as `countSplitRows` pairs them; an expand row between the two draws
 * above the pairs. Answers the index of the run after the change.
 */
function drawSplitChange(
  state: PlanState,
  runs: readonly RowRun[],
  from: number,
  context: PlanContext,
): number {
  const removed = runs[from]?.length ?? 0;
  let next = from + 1;
  let between = runs[next];
  while (between?.kind === RowRunKinds.EXPAND) {
    drawRun(state, between, context);
    next += 1;
    between = runs[next];
  }
  const following = runs[next];
  const added = following?.kind === RowRunKinds.ADDED ? following.length : 0;

  const pairs = Math.max(removed, added);
  for (let pair = 0; pair < pairs && hasRoom(state); pair += 1) {
    const kinds: RowKinds = {
      left:
        pair < removed ? SkeletonSideKinds.REMOVED : SkeletonSideKinds.EMPTY,
      right: pair < added ? SkeletonSideKinds.ADDED : SkeletonSideKinds.EMPTY,
    };
    pushCodeRow(state, kinds, context);
  }

  return added > 0 ? next + 1 : next;
}

/** Rows of one run, stopping at the cap so a long run costs no more than the cap. */
function drawRun(state: PlanState, run: RowRun, context: PlanContext): void {
  for (let row = 0; row < run.length && hasRoom(state); row += 1) {
    drawRow(state, run.kind, context);
  }
}

function hasRoom(state: PlanState): boolean {
  return state.lines < MAX_SKELETON_ROWS;
}

function drawRow(
  state: PlanState,
  kind: RowRun["kind"],
  context: PlanContext,
): void {
  if (kind === RowRunKinds.HUNK) {
    pushLane(state, true);
    return;
  }
  if (kind === RowRunKinds.EXPAND) {
    pushLane(state, false);
    return;
  }
  if (kind === RowRunKinds.NOTE) {
    pushRow(state, makeNoteRow(state.rows.length, context.split), 1);
    return;
  }
  pushCodeRow(state, resolveRowKinds(kind, context.split), context);
}

function resolveRowKinds(kind: RowRun["kind"], split: boolean): RowKinds {
  if (kind === RowRunKinds.ADDED) {
    return split
      ? { left: SkeletonSideKinds.EMPTY, right: SkeletonSideKinds.ADDED }
      : { left: SkeletonSideKinds.ADDED };
  }
  if (kind === RowRunKinds.REMOVED) {
    return split
      ? { left: SkeletonSideKinds.REMOVED, right: SkeletonSideKinds.EMPTY }
      : { left: SkeletonSideKinds.REMOVED };
  }
  return split
    ? { left: SkeletonSideKinds.CONTEXT, right: SkeletonSideKinds.CONTEXT }
    : { left: SkeletonSideKinds.CONTEXT };
}

/** A hunk header's band, the first with one arrow, or an expand control's own row. */
function pushLane(state: PlanState, band: boolean): void {
  if (!band) {
    pushRow(state, makeLane(state.rows.length, false, 1, 0), 1);
    return;
  }
  const arrows = state.hunkLanes === 0 ? 1 : 2;
  const header = HEADER_COLUMNS[state.hunkLanes % HEADER_COLUMNS.length] ?? 0;
  state.hunkLanes += 1;
  pushRow(state, makeLane(state.rows.length, true, arrows, header), 1);
}

function makeLane(
  key: number,
  band: boolean,
  arrows: 1 | 2,
  header: number,
): PlannedRow {
  return { type: SkeletonRowTypes.LANE, key, band, arrows, header };
}

function pushCodeRow(
  state: PlanState,
  kinds: RowKinds,
  context: PlanContext,
): void {
  const row = makeCodeRow(state.rows.length, state.widthIndex, kinds, context);
  state.widthIndex += 1;
  pushRow(state, row, row.span);
}

/** Past the cap no row is drawn; the plan's fill covers the rest. */
function pushRow(state: PlanState, row: PlannedRow, span: number): void {
  if (state.lines + span > MAX_SKELETON_ROWS) {
    state.lines = MAX_SKELETON_ROWS;
    return;
  }
  state.rows.push(row);
  state.lines += span;
}

/** One-line context rows up to the reserved lines: wraps the histogram gave no drawn row. */
function padContextRows(
  state: PlanState,
  reservedLines: number,
  split: boolean,
): void {
  while (state.lines < reservedLines) {
    pushRow(state, makePaddingRow(state.rows.length, split), 1);
  }
}

function countNoteRows(runs: readonly RowRun[]): number {
  return runs
    .filter((run) => run.kind === RowRunKinds.NOTE)
    .reduce((total, run) => total + run.length, 0);
}

function computeShare(total: number, parts: number, index: number): number {
  const extra = index < total % parts ? 1 : 0;
  return Math.floor(total / parts) + extra;
}
