import type { ChunkLayoutCounts } from "brief-core/chunk-layout";
import { DiffViews, type DiffView } from "@web/components/DiffRows/types";
import {
  listBucketWraps,
  resolveWrapHistogram,
  type BucketWrap,
  type WrapColumns,
} from "../../reading/chunk-height-model";
import {
  BUCKET_WIDTH_OFFSET,
  FALLBACK_ROW_COLUMNS,
  FIRST_TOKEN_SPREAD,
  INDENT_RHYTHM,
  INDENT_STEP,
  MIN_FIRST_TOKEN,
  MIN_INDENTED_BAR,
  MIN_LAST_TOKEN,
  MIN_SECOND_TOKEN,
  MIN_SECOND_TOKEN_SHARE,
  MIN_TAIL_COLUMNS,
  MIN_TOKENED_COLUMNS,
  NOTE_COLUMNS,
  PADDING_WIDTH_SPREAD,
  PADDING_WIDTH_STRIDE,
  PAIRED_SIDE_FRACTIONS,
  SECOND_TOKEN_SEED_STRIDE,
  SECOND_TOKEN_SHARE_STEP,
  SECOND_TOKEN_STEPS,
  WIDTH_FRACTIONS,
  WIDTH_STRIDES,
} from "./consts";
import {
  SkeletonRowTypes,
  SkeletonSideKinds,
  type PlannedCodeRow,
  type SkeletonSide,
  type SkeletonSideKind,
} from "./types";

/** What a code row needs to know about the card to take its shape. */
export interface PlanContext {
  split: boolean;
  /** Columns a code cell wraps at in the view. */
  columns: number;
  /** Code rows that take a width from the histogram: notes and hunk headers excluded. */
  widthRows: number;
  stride: number;
  buckets: readonly BucketWrap[];
}

/** The side kinds of one code row: the unified view reads `left` alone. */
export interface RowKinds {
  left: SkeletonSideKind;
  right?: SkeletonSideKind;
}

interface RowShape {
  span: number;
  width: number;
}

export function makePlanContext(
  counts: ChunkLayoutCounts,
  view: DiffView,
  noteRows: number,
  wrapColumns: WrapColumns,
): PlanContext {
  const split = view === DiffViews.SPLIT;
  const { histogram, columns } = resolveWrapHistogram(
    counts,
    view,
    wrapColumns,
  );
  const paintedRows = split ? counts.splitRows : counts.rows;
  const widthRows = Math.max(paintedRows - counts.hunkRows - noteRows, 0);

  return {
    split,
    columns,
    widthRows,
    stride: pickStride(widthRows),
    buckets: listBucketWraps(histogram, columns),
  };
}

/**
 * The `widthIndex`th code row: its span and width from the histogram, the
 * wider side of a changed pair carrying the row's width.
 */
export function makeCodeRow(
  key: number,
  widthIndex: number,
  kinds: RowKinds,
  context: PlanContext,
): PlannedCodeRow {
  const shape = shapeRow(widthIndex, context);
  const indent = readIndent(widthIndex, shape.width);
  const row: PlannedCodeRow = {
    type: SkeletonRowTypes.CODE,
    key,
    span: shape.span,
    left: makeSide(kinds.left, shape.width, indent, widthIndex),
  };
  if (kinds.right === undefined) {
    return row;
  }

  const paired =
    kinds.left !== SkeletonSideKinds.CONTEXT &&
    kinds.left !== SkeletonSideKinds.EMPTY &&
    kinds.right !== SkeletonSideKinds.EMPTY;
  if (!paired) {
    row.right = makeSide(kinds.right, shape.width, indent, widthIndex);
    return row;
  }
  const narrow = computeNarrowWidth(widthIndex, shape.width, indent);
  const leftWide = widthIndex % 2 === 0;
  row.left = makeSide(
    kinds.left,
    leftWide ? shape.width : narrow,
    indent,
    widthIndex,
  );
  row.right = makeSide(
    kinds.right,
    leftWide ? narrow : shape.width,
    indent,
    widthIndex + 1,
  );
  return row;
}

/** A diff note's row: one short line on each side it shows on. */
export function makeNoteRow(key: number, split: boolean): PlannedCodeRow {
  const note = makeSide(SkeletonSideKinds.CONTEXT, NOTE_COLUMNS, 0, key);
  const row: PlannedCodeRow = {
    type: SkeletonRowTypes.CODE,
    key,
    span: 1,
    left: note,
  };
  if (split) {
    row.right = note;
  }
  return row;
}

/** A one-line context row past the histogram's entries. */
export function makePaddingRow(key: number, split: boolean): PlannedCodeRow {
  const spread = (key * PADDING_WIDTH_STRIDE) % PADDING_WIDTH_SPREAD;
  const width = FALLBACK_ROW_COLUMNS + spread;
  const side = makeSide(SkeletonSideKinds.CONTEXT, width, INDENT_STEP, key);
  const row: PlannedCodeRow = {
    type: SkeletonRowTypes.CODE,
    key,
    span: 1,
    left: side,
  };
  if (split) {
    row.right = side;
  }
  return row;
}

/**
 * Rows walk the histogram's entries in a spread order, so wide rows do not
 * bunch; a row past the entries draws one line. A row's width falls inside
 * the lines its span gives it.
 */
function shapeRow(widthIndex: number, context: PlanContext): RowShape {
  const entry = (widthIndex * context.stride) % Math.max(context.widthRows, 1);
  const bucket = findEntryBucket(context.buckets, entry);
  if (bucket === undefined) {
    return { span: 1, width: FALLBACK_ROW_COLUMNS };
  }

  const span = bucket.extraLines + 1;
  const fraction = WIDTH_FRACTIONS[widthIndex % WIDTH_FRACTIONS.length] ?? 1;
  const natural = Math.round(bucket.columns * (fraction + BUCKET_WIDTH_OFFSET));
  const floor = (span - 1) * context.columns + MIN_TAIL_COLUMNS;
  const ceiling = span * context.columns;

  return { span, width: Math.min(Math.max(natural, floor), ceiling) };
}

function findEntryBucket(
  buckets: readonly BucketWrap[],
  entry: number,
): BucketWrap | undefined {
  let passed = 0;
  for (const bucket of buckets) {
    passed += bucket.rows;
    if (entry < passed) {
      return bucket;
    }
  }
  return undefined;
}

function makeSide(
  kind: SkeletonSideKind,
  width: number,
  indent: number,
  seed: number,
): SkeletonSide {
  if (kind === SkeletonSideKinds.EMPTY) {
    return { kind, indent: 0, width: 0, breaks: [] };
  }
  const fitted = Math.min(indent, width);
  return {
    kind,
    indent: fitted,
    width,
    breaks: makeBreaks(width - fitted, seed),
  };
}

function readIndent(widthIndex: number, width: number): number {
  const level = INDENT_RHYTHM[widthIndex % INDENT_RHYTHM.length] ?? 1;
  return Math.min(level * INDENT_STEP, Math.max(width - MIN_INDENTED_BAR, 0));
}

function computeNarrowWidth(
  widthIndex: number,
  width: number,
  indent: number,
): number {
  const fraction =
    PAIRED_SIDE_FRACTIONS[widthIndex % PAIRED_SIDE_FRACTIONS.length] ?? 1;
  return Math.max(Math.round(width * fraction), indent + 1);
}

/** Token edges for the neutral ink's bar: a keyword, an identifier, the rest. */
function makeBreaks(length: number, seed: number): number[] {
  if (length < MIN_TOKENED_COLUMNS) {
    return [];
  }
  const first = MIN_FIRST_TOKEN + (seed % FIRST_TOKEN_SPREAD);
  const shareStep = (seed * SECOND_TOKEN_SEED_STRIDE) % SECOND_TOKEN_STEPS;
  const share = MIN_SECOND_TOKEN_SHARE + shareStep * SECOND_TOKEN_SHARE_STEP;
  const secondLength = Math.max(MIN_SECOND_TOKEN, Math.round(length * share));
  const second = first + 1 + secondLength;
  const hasThirdToken = second < length - MIN_LAST_TOKEN;
  return hasThirdToken ? [first, second] : [first];
}

function pickStride(rows: number): number {
  const coprime = WIDTH_STRIDES.find(
    (stride) => findGreatestCommonDivisor(stride, rows) === 1,
  );
  return coprime ?? 1;
}

function findGreatestCommonDivisor(first: number, second: number): number {
  let larger = first;
  let smaller = second;
  while (smaller !== 0) {
    [larger, smaller] = [smaller, larger % smaller];
  }
  return larger;
}
