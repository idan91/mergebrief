import { findRowByLine } from "@web/components/DiffRows/utils";
import { revisionJumpSelector } from "../../../../model/comparison/runs";
import {
  deriveGroupHeadingId,
  deriveGroupSectionId,
  readNumericCssVar,
  STICKY_STACK_HEIGHT_VAR,
} from "../utils";
import { CHUNK_SCROLL_GAP_PX } from "./engine/consts";
import {
  ScrollActionKinds,
  type MountedTarget,
  type ScrollAction,
  type ScrollReading,
} from "./engine/types";
import {
  ScrollTargetKinds,
  type ChunkScrollTarget,
  type ConversationScrollTarget,
  type RowScrollTarget,
  type ScrollActionInput,
  type ScrollTarget,
} from "./types";

/** The pinned stack's height plus the scroll gap, read as one registered length. */
export function readUnderStackTop(): number {
  const underStackTop =
    readNumericCssVar(STICKY_STACK_HEIGHT_VAR) + CHUNK_SCROLL_GAP_PX;
  return underStackTop;
}

/** The chunk whose card holds the target; undefined outside the chunk lists. */
export function deriveTargetChunkId(target: ScrollTarget): string | undefined {
  if (target.kind === ScrollTargetKinds.GROUP) {
    return undefined;
  }
  if (target.kind === ScrollTargetKinds.SECTION) {
    return undefined;
  }
  return target.chunkId;
}

/**
 * The row inside the chunk's own card: a thread renders again in every
 * sibling span that shows its line, so the search never leaves the card.
 */
function findTargetRow(
  chunkId: string,
  row: ConversationScrollTarget,
): HTMLElement | null {
  const card = document.getElementById(chunkId);
  if (card === null) {
    return null;
  }
  if ("threadId" in row) {
    return card.querySelector<HTMLElement>(
      `[data-conversation-thread="${String(row.threadId)}"]`,
    );
  }

  return findRowByLine(card, row.side, row.line);
}

/** Kept-warm panes keep their DOM: only a rail outside a hidden pane counts. */
function findVisibleRail(railKey: string): HTMLElement | null {
  const rails = document.querySelectorAll<HTMLElement>(
    revisionJumpSelector(railKey),
  );
  for (const rail of rails) {
    if (rail.closest("[hidden]") === null) {
      return rail;
    }
  }
  return null;
}

function findScrollElementOrNull(target: ScrollTarget): HTMLElement | null {
  if (target.kind === ScrollTargetKinds.GROUP) {
    return document.getElementById(deriveGroupSectionId(target.groupId));
  }
  if (target.kind === ScrollTargetKinds.SECTION) {
    return document.getElementById(target.sectionId);
  }
  if (target.kind === ScrollTargetKinds.ROW) {
    return findTargetRow(target.chunkId, target.row);
  }
  if (target.kind === ScrollTargetKinds.RAIL) {
    return findVisibleRail(target.railKey);
  }
  return document.getElementById(target.chunkId);
}

/** The element the scroll goes to, once it is mounted. */
export function findScrollElement(
  target: ScrollTarget,
): HTMLElement | undefined {
  return findScrollElementOrNull(target) ?? undefined;
}

/**
 * The cached element while it is still mounted and visible, so a watch does
 * not query the DOM every frame; otherwise a fresh lookup.
 */
export function refindScrollElement(
  target: ScrollTarget,
  cached: HTMLElement | undefined,
): HTMLElement | undefined {
  const live =
    cached?.isConnected === true && cached.closest("[hidden]") === null;
  if (live) {
    return cached;
  }
  return findScrollElement(target);
}

/**
 * A group hands focus to its heading and a thread to its disclosure; a line's
 * row gets a one-off tab stop only when it has none, so an expanded row and a
 * rail's button keep their own.
 */
function findFocusElement(
  target: ScrollTarget,
  element: HTMLElement,
): HTMLElement | null {
  if (target.kind === ScrollTargetKinds.GROUP) {
    return document.getElementById(deriveGroupHeadingId(target.groupId));
  }
  if (target.kind !== ScrollTargetKinds.ROW) {
    return element;
  }
  if ("threadId" in target.row) {
    return element.querySelector("button") ?? element;
  }
  if (!element.hasAttribute("tabindex")) {
    element.tabIndex = -1;
  }
  return element;
}

export function focusScrollTarget(
  target: ScrollTarget,
  element: HTMLElement,
): void {
  findFocusElement(target, element)?.focus({ preventScroll: true });
}

/** A row that never rendered concedes to its card, when the card is mounted. */
export function findFallbackCard(
  target: ScrollTarget,
  arrived: boolean,
): ChunkScrollTarget | undefined {
  const concedes = !arrived && target.kind === ScrollTargetKinds.ROW;
  if (!concedes) {
    return undefined;
  }
  return findMountedCard(target);
}

function findMountedCard(
  target: RowScrollTarget,
): ChunkScrollTarget | undefined {
  if (document.getElementById(target.chunkId) === null) {
    return undefined;
  }
  return { kind: ScrollTargetKinds.CHUNK, chunkId: target.chunkId };
}

function readMountedTarget(
  element: HTMLElement | undefined,
): MountedTarget | undefined {
  if (element === undefined) {
    return undefined;
  }
  const { top, bottom } = element.getBoundingClientRect();
  // Attribute check, not getClientRects: jsdom has no layout, so a rect
  // check would also veto every legitimate test scroll.
  return { top, bottom, hidden: element.closest("[hidden]") !== null };
}

export function readScrollState(
  element: HTMLElement | undefined,
): ScrollReading {
  return {
    target: readMountedTarget(element),
    scrollY: window.scrollY,
    viewportHeight: window.innerHeight,
    stackHeight: readNumericCssVar(STICKY_STACK_HEIGHT_VAR),
  };
}

/**
 * A target outside the chunk lists, or one whose card is mounted, waits for
 * its own mount; otherwise the windows bring its chunk near or refuse it.
 */
function askChunkWindows(input: ScrollActionInput): boolean {
  if (input.chunkId === undefined) {
    return true;
  }
  if (document.getElementById(input.chunkId) !== null) {
    return true;
  }
  return input.chunkWindows?.scrollToChunk(input.chunkId) === true;
}

/** False when the scroll action ends the scroll: the windows refused the chunk. */
export function performScrollAction(
  action: ScrollAction,
  input: ScrollActionInput,
): boolean {
  if (action.kind === ScrollActionKinds.SCROLL_INTO_VIEW) {
    input.element?.scrollIntoView({
      behavior: action.behavior,
      block: action.block,
    });
    return true;
  }
  if (action.kind === ScrollActionKinds.SCROLL_TO) {
    window.scrollTo({ behavior: action.behavior, top: action.top });
    return true;
  }
  if (action.kind === ScrollActionKinds.SCROLL_BY) {
    window.scrollBy({ behavior: "instant", top: action.top });
    return true;
  }
  if (action.kind === ScrollActionKinds.ASK_WINDOWS) {
    return askChunkWindows(input);
  }
  return true;
}
