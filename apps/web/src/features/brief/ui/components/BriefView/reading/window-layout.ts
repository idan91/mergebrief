import type { CSSProperties } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";

export interface FirstPaintCardStyle extends CSSProperties {
  "--diff-first-paint-visibility": "visible";
}

/**
 * A windowed list's own style. Its cards sit in flow, never at an inset, so
 * the browser's scroll anchoring holds the page still when a card above the
 * viewport changes height: a changed inset on the anchor's ancestors
 * suppresses anchoring.
 */
export const WINDOW_LIST_STYLE: CSSProperties = { inlineSize: "100%" };

/**
 * A card's slot in the list. Its own formatting context keeps the card's
 * margins inside the box the virtualizer measures; without it the margin
 * collapses through, and every card sits further down than the model says.
 */
export const WINDOW_CARD_STYLE: CSSProperties = { display: "flow-root" };

/**
 * A card mounting with its top above the viewport paints its diff table in
 * full for its first frame, so it reaches its real height before the reader
 * scrolls up onto it. A card below grows away from the reader and keeps the
 * cheaper placeholder.
 */
export const FIRST_PAINT_CARD_STYLE: FirstPaintCardStyle = {
  ...WINDOW_CARD_STYLE,
  "--diff-first-paint-visibility": "visible",
};

export interface WindowSlot {
  item: VirtualItem;
  /** The empty track between this card and the previous one, or the list's start. */
  gapBefore: number;
  /** The one track that stands in for the gap and the card when the card is missing. */
  missingTrack: number;
  /** First paint in full for a card starting above the viewport, whose growth moves what the reader sees. */
  style: CSSProperties;
}

export interface WindowSlots {
  slots: WindowSlot[];
  /** The empty track after the last rendered card. */
  trailing: number;
}

/**
 * The rendered cards' slots, each with the empty track before it, and the track
 * after the last, so the list keeps the virtualizer's full height in flow.
 * The tracks are the cards' siblings: sizing the list itself would suppress
 * anchoring for every card inside it.
 */
export function deriveWindowSlots(
  items: readonly VirtualItem[],
  scrollMargin: number,
  totalSize: number,
  viewportTop: number,
): WindowSlots {
  const slots: WindowSlot[] = [];
  let edge = scrollMargin;
  for (const item of items) {
    const gapBefore = Math.max(item.start - edge, 0);
    const startsAboveViewport = item.start < viewportTop;
    slots.push({
      item,
      gapBefore,
      missingTrack: gapBefore + item.size,
      style: startsAboveViewport ? FIRST_PAINT_CARD_STYLE : WINDOW_CARD_STYLE,
    });
    edge = Math.max(edge, item.end);
  }

  const listEnd = scrollMargin + totalSize;
  return { slots, trailing: Math.max(listEnd - edge, 0) };
}

export function refuseScrollCompensation(): boolean {
  return false;
}

/**
 * The rule between holds. Where the browser anchors scrolling, it moves the
 * page for a card resizing above the viewport, and a second, scripted move would
 * double it; a browser without scroll anchoring keeps the library's own rule
 * (`undefined`).
 */
export function resolveRestingCompensation():
  | typeof refuseScrollCompensation
  | undefined {
  const anchorsScroll =
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("overflow-anchor", "auto");
  return anchorsScroll ? refuseScrollCompensation : undefined;
}
