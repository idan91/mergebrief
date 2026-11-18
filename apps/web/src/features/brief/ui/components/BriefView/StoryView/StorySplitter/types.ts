import type { ValueOf } from "types/utils";

// Values are the media queries themselves; they track when-story-stacks in
// styles/_layout.scss. An expanded sidebar overlays the story wherever its
// reserve would stack it, so it stacks where a collapsed one does.
export const StackedQueries = {
  BARE: "(width <= 1220px)",
  SIDEBAR: "(width <= 1268px)",
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
