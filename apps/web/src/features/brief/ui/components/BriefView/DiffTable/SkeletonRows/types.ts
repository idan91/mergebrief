import type { ValueOf } from "types/utils";

/**
 * How a skeleton is inked: the diff's anatomy in muted colour, read from a
 * stored row runs, or a colourless shape when no row runs say where the
 * changes sit.
 */
export const SkeletonInks = {
  MIRROR: "mirror",
  NEUTRAL: "neutral",
} as const;
export type SkeletonInk = ValueOf<typeof SkeletonInks>;

/** What one side of a skeleton row stands for. */
export const SkeletonSideKinds = {
  CONTEXT: "context",
  ADDED: "added",
  REMOVED: "removed",
  EMPTY: "empty",
} as const;
export type SkeletonSideKind = ValueOf<typeof SkeletonSideKinds>;

export const SkeletonRowTypes = {
  CODE: "code",
  LANE: "lane",
} as const;

export interface SkeletonSide {
  kind: SkeletonSideKind;
  /** Leading whitespace, in columns. */
  indent: number;
  /** Display width, in columns, indentation included. */
  width: number;
  /** Where the neutral ink breaks the bar between tokens, in columns past the indent. */
  breaks: readonly number[];
}

/** A code row: one side in the unified view, both in the split view. */
export interface PlannedCodeRow {
  type: typeof SkeletonRowTypes.CODE;
  key: number;
  /** Lines the row takes: more than one where its code wraps. */
  span: number;
  left: SkeletonSide;
  right?: SkeletonSide;
}

/** A hunk header's band, or an expand control's own row. */
export interface PlannedLane {
  type: typeof SkeletonRowTypes.LANE;
  key: number;
  /** A hunk header draws the band; an expand control's own row does not. */
  band: boolean;
  /** Expand arrows drawn at the lane's start: up, or up and down. */
  arrows: 1 | 2;
  /** Header text width, in columns of the lane's small type; 0 draws none. */
  header: number;
}

export type PlannedRow = PlannedCodeRow | PlannedLane;

export interface SkeletonPlan {
  rows: PlannedRow[];
  /** The card reserves more lines than the cap draws: a fill covers the rest. */
  filled: boolean;
  ink: SkeletonInk;
}
