import { findRowByLine } from "@web/components/DiffRows/utils";
import { prefersReducedMotion } from "@web/utils/motion";
import { revisionJumpSelector } from "../../../../model/comparison/runs";
import { CHUNK_LANDING_GAP_PX } from "../consts";
import type { ConversationLanding } from "../useConversationWiring/types";
import {
  deriveGroupHeadingId,
  deriveGroupSectionId,
  readNumericCssVar,
  SCROLL_ABORT_EVENTS,
  STICKY_STACK_HEIGHT_VAR,
} from "../utils";
import { FLASH_MS, LANDING_FLASH_ATTR, PLACEMENT_DEFER_FRAMES } from "./consts";
import {
  LandingActionKinds,
  LandingPhases,
  LandMotions,
  LandTargetKinds,
  type ChunkLandTarget,
  type Flash,
  type LandingAction,
  type LandingActionInput,
  type LandingReading,
  type LandingState,
  type LandMotion,
  type LandPlacement,
  type LandTarget,
  type MountedTarget,
  type RowLandTarget,
} from "./types";

/** The pinned stack's height plus the landing gap, read as one registered length. */
export function readUnderStackTop(): number {
  const underStackTop =
    readNumericCssVar(STICKY_STACK_HEIGHT_VAR) + CHUNK_LANDING_GAP_PX;
  return underStackTop;
}

/** The chunk whose card holds the target; undefined outside the chunk lists. */
export function deriveTargetChunkId(target: LandTarget): string | undefined {
  if (target.kind === LandTargetKinds.GROUP) {
    return undefined;
  }
  if (target.kind === LandTargetKinds.SECTION) {
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
  row: ConversationLanding,
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

function findLandingElementOrNull(target: LandTarget): HTMLElement | null {
  if (target.kind === LandTargetKinds.GROUP) {
    return document.getElementById(deriveGroupSectionId(target.groupId));
  }
  if (target.kind === LandTargetKinds.SECTION) {
    return document.getElementById(target.sectionId);
  }
  if (target.kind === LandTargetKinds.ROW) {
    return findTargetRow(target.chunkId, target.row);
  }
  if (target.kind === LandTargetKinds.RAIL) {
    return findVisibleRail(target.railKey);
  }
  return document.getElementById(target.chunkId);
}

/** The element the landing scrolls to, once it is mounted. */
export function findLandingElement(
  target: LandTarget,
): HTMLElement | undefined {
  return findLandingElementOrNull(target) ?? undefined;
}

/**
 * The cached element while it is still mounted and visible, so a watch does
 * not query the DOM every frame; otherwise a fresh lookup.
 */
export function refindLandingElement(
  target: LandTarget,
  cached: HTMLElement | undefined,
): HTMLElement | undefined {
  const live =
    cached?.isConnected === true && cached.closest("[hidden]") === null;
  if (live) {
    return cached;
  }
  return findLandingElement(target);
}

/**
 * A group hands focus to its heading and a thread to its disclosure; a line's
 * row gets a one-off tab stop only when it has none, so an expanded row and a
 * rail's button keep their own.
 */
function findFocusElement(
  target: LandTarget,
  element: HTMLElement,
): HTMLElement | null {
  if (target.kind === LandTargetKinds.GROUP) {
    return document.getElementById(deriveGroupHeadingId(target.groupId));
  }
  if (target.kind !== LandTargetKinds.ROW) {
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

export function focusLandingTarget(
  target: LandTarget,
  element: HTMLElement,
): void {
  findFocusElement(target, element)?.focus({ preventScroll: true });
}

/** A row that never rendered concedes to its card, when the card is mounted. */
export function findFallbackCard(
  target: LandTarget,
  arrived: boolean,
): ChunkLandTarget | undefined {
  const concedes = !arrived && target.kind === LandTargetKinds.ROW;
  if (!concedes) {
    return undefined;
  }
  return findMountedCard(target);
}

function findMountedCard(target: RowLandTarget): ChunkLandTarget | undefined {
  if (document.getElementById(target.chunkId) === null) {
    return undefined;
  }
  return { kind: LandTargetKinds.CHUNK, chunkId: target.chunkId };
}

export function createFlash(): Flash {
  return { element: undefined, frame: undefined, timer: undefined };
}

export function stopFlash(flash: Flash): void {
  if (flash.frame !== undefined) {
    window.cancelAnimationFrame(flash.frame);
    flash.frame = undefined;
  }
  if (flash.timer !== undefined) {
    window.clearTimeout(flash.timer);
    flash.timer = undefined;
  }
  flash.element?.removeAttribute(LANDING_FLASH_ATTR);
  flash.element = undefined;
}

/** The attribute is dropped for a frame, so a repeat landing restarts the animation. */
export function startFlash(flash: Flash, element: HTMLElement): void {
  stopFlash(flash);
  flash.element = element;
  flash.frame = window.requestAnimationFrame(() => {
    flash.frame = undefined;
    element.setAttribute(LANDING_FLASH_ATTR, "");
    flash.timer = window.setTimeout(() => stopFlash(flash), FLASH_MS);
  });
}

/**
 * The user's own input aborts the landing: a late correction would yank them
 * away from wherever they moved. Capture phase, so a control that stops
 * propagation still ends it. Returns the remover, so a stale landing's
 * listeners never survive into the next one and cancel it.
 */
export function armLandingAbort(cancelLanding: () => void): () => void {
  for (const type of SCROLL_ABORT_EVENTS) {
    window.addEventListener(type, cancelLanding, {
      capture: true,
      once: true,
      passive: true,
    });
  }
  return () => {
    for (const type of SCROLL_ABORT_EVENTS) {
      window.removeEventListener(type, cancelLanding, { capture: true });
    }
  };
}

export function deriveScrollBehavior(motion: LandMotion): ScrollBehavior {
  if (motion === LandMotions.INSTANT) {
    return "instant";
  }
  return prefersReducedMotion() ? "auto" : "smooth";
}

/** Callers still speaking `ScrollBehavior`: "auto" defers to the page's smooth scrolling. */
export function deriveLandMotion(behavior: ScrollBehavior): LandMotion {
  if (behavior === "instant") {
    return LandMotions.INSTANT;
  }
  return LandMotions.SMOOTH;
}

export function startLanding(placement: LandPlacement): LandingState {
  const framesLeft = PLACEMENT_DEFER_FRAMES[placement];
  if (framesLeft > 0) {
    return { phase: LandingPhases.DEFER, framesLeft };
  }
  return { phase: LandingPhases.JUMP };
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

export function readLanding(element: HTMLElement | undefined): LandingReading {
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
function askChunkWindows(input: LandingActionInput): boolean {
  if (input.chunkId === undefined) {
    return true;
  }
  if (document.getElementById(input.chunkId) !== null) {
    return true;
  }
  return input.chunkWindows?.scrollToChunk(input.chunkId) === true;
}

/** False when the action ends the landing: the windows refused the chunk. */
export function performLandingAction(
  action: LandingAction,
  input: LandingActionInput,
): boolean {
  if (action.kind === LandingActionKinds.SCROLL_INTO_VIEW) {
    input.element?.scrollIntoView({
      behavior: action.behavior,
      block: action.block,
    });
    return true;
  }
  if (action.kind === LandingActionKinds.SCROLL_TO) {
    window.scrollTo({ behavior: action.behavior, top: action.top });
    return true;
  }
  if (action.kind === LandingActionKinds.SCROLL_BY) {
    window.scrollBy({ behavior: "instant", top: action.top });
    return true;
  }
  if (action.kind === LandingActionKinds.ASK_WINDOWS) {
    return askChunkWindows(input);
  }
  return true;
}
