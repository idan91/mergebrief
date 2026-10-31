/**
 * The card a reader is looking at, and where its top sat: when the code
 * lands, every card above it grows from its reserved height to its painted
 * one, and the page scrolls by that drift so the card stays put.
 */
export interface ScreenAnchor {
  readonly element: Element;
  readonly top: number;
  /** The page's scroll when the card was found. */
  readonly scrollY: number;
}

/**
 * The card at the reading line: the first, in document order, whose top sits
 * between the pinned stack's bottom and the viewport's. A card crossing that
 * line is held only when no card starts below it, because holding it lets its
 * own growth move the card the reader is on.
 */
export function findScreenAnchor(
  cards: Iterable<Element>,
  viewportHeight: number,
  scrollY: number,
  stackHeight: number,
): ScreenAnchor | undefined {
  let crossing: ScreenAnchor | undefined;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (rect.top >= viewportHeight) {
      continue;
    }
    if (rect.top >= stackHeight) {
      return { element: card, top: rect.top, scrollY };
    }
    const crossesLine = crossing === undefined && rect.bottom > stackHeight;
    if (crossesLine) {
      crossing = { element: card, top: rect.top, scrollY };
    }
  }
  return crossing;
}

/**
 * Whether the anchor still names the card on screen. A scroll that moved the
 * page since it was found (a jump whose scroll event has not fired yet) left
 * it stale, and holding it would undo the jump.
 */
export function isAnchorCurrent(
  anchor: ScreenAnchor,
  scrollY: number,
): boolean {
  return anchor.scrollY === scrollY;
}

/** How far the anchor moved since it was found; 0 once it left the document. */
export function readAnchorDrift(anchor: ScreenAnchor): number {
  if (!anchor.element.isConnected) {
    return 0;
  }
  return anchor.element.getBoundingClientRect().top - anchor.top;
}
