import type { ValueOf } from "types/utils";

// Values are the media queries themselves; they track the stack-split
// breakpoints in StoryView.module.scss.
export const StackedQueries = {
  BARE: "(width <= 1220px)",
  SIDEBAR_COLLAPSED: "(width <= 1268px)",
  SIDEBAR_EXPANDED: "(width <= 1644px)",
} as const;

export type StackedQuery = ValueOf<typeof StackedQueries>;

export type TextDirection = "ltr" | "rtl";

export interface TrackStepBounds {
  step: number;
  floor: number;
  ceiling: number;
}

export interface GroupMeasure {
  column: number;
  chunks: number;
  card: number;
}

export interface StoryDrag {
  pointerId: number;
  startX: number;
  startTrack: number;
  main: HTMLElement;
  /** The inline value before the drag, restored on cancel. */
  priorTrack: string;
  /** Set once the pointer travels past the slop; a click commits nothing. */
  moved: boolean;
}
