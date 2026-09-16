import { SidebarLayouts, type SidebarLayout } from "../../utils";
import {
  STORY_CARD_CEILING_PX,
  STORY_CARD_FLOOR_PX,
  STORY_CARD_TRACK_PROPERTY,
  STORY_DIFF_FLOOR_PX,
  STORY_DIFF_HEADROOM_PX,
} from "./consts";
import {
  StackedQueries,
  type GroupMeasure,
  type StackedQuery,
  type StoryDrag,
  type TextDirection,
  type TrackStepBounds,
} from "./types";

/** The card sits at the inline end, so moving toward the start widens it. */
export function deriveTrackFromPointer(
  startTrack: number,
  startX: number,
  clientX: number,
  direction: TextDirection,
): number {
  const delta = clientX - startX;
  return direction === "rtl" ? startTrack + delta : startTrack - delta;
}

/** Arrow keys move the separator on screen; Home and End hit the bounds. */
export function stepTrack(
  track: number,
  key: string,
  direction: TextDirection,
  bounds: TrackStepBounds,
): number | undefined {
  if (key === "Home") return bounds.floor;
  if (key === "End") return bounds.ceiling;
  if (key !== "ArrowLeft" && key !== "ArrowRight") return undefined;

  const towardStart = (key === "ArrowLeft") === (direction === "ltr");
  const next = towardStart ? track + bounds.step : track - bounds.step;
  return Math.min(bounds.ceiling, Math.max(bounds.floor, next));
}

/** Mirrors the clamp ceiling in styles/base.scss; the gap is measured. */
export function deriveCardCeiling(columnWidth: number, gap: number): number {
  const diffReserve = STORY_DIFF_FLOOR_PX + STORY_DIFF_HEADROOM_PX + gap;
  const ceiling = Math.min(STORY_CARD_CEILING_PX, columnWidth - diffReserve);
  return Math.max(STORY_CARD_FLOOR_PX, ceiling);
}

export function resolveStackedQuery(
  sidebar: SidebarLayout | undefined,
): StackedQuery {
  if (sidebar === SidebarLayouts.COLLAPSED) {
    return StackedQueries.SIDEBAR_COLLAPSED;
  }
  if (sidebar === SidebarLayouts.EXPANDED)
    return StackedQueries.SIDEBAR_EXPANDED;
  return StackedQueries.BARE;
}

/** The nearest `dir` wins; a document without one reads left to right. */
export function resolveTextDirection(node: Element): TextDirection {
  const dir = node.closest("[dir]")?.getAttribute("dir");
  return dir === "rtl" ? "rtl" : "ltr";
}

export function readStacked(query: string): boolean {
  return window.matchMedia(query).matches;
}

export function readServerStacked(): boolean {
  return false;
}

/** Border-box width, which is what the grid track and the clamp size. */
export function readEntryWidth(entry: ResizeObserverEntry): number {
  const borderBox = entry.borderBoxSize?.[0];
  return Math.round(borderBox?.inlineSize ?? entry.contentRect.width);
}

export function isSameMeasure(a: GroupMeasure, b: GroupMeasure): boolean {
  return a.column === b.column && a.chunks === b.chunks && a.card === b.card;
}

export function hasMovedPastSlop(
  drag: StoryDrag,
  clientX: number,
  slop: number,
): boolean {
  return drag.moved || Math.abs(clientX - drag.startX) >= slop;
}

/** jsdom has no pointer capture; the guard keeps the tests on real paths. */
export function releaseCapture(target: Element, pointerId: number): void {
  if (typeof target.releasePointerCapture === "function") {
    target.releasePointerCapture(pointerId);
  }
}

export function restoreTrack(drag: StoryDrag): void {
  if (drag.priorTrack === "") {
    drag.main.style.removeProperty(STORY_CARD_TRACK_PROPERTY);
  } else {
    drag.main.style.setProperty(STORY_CARD_TRACK_PROPERTY, drag.priorTrack);
  }
}
