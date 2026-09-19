// The landing choreography as plain functions: each takes the chain's
// context, so the hook that owns the refs stays a list of decisions.
import { findRowByLine } from "@web/components/DiffRows/utils";
import { prefersReducedMotion } from "@web/utils/motion";
import {
  deriveRowLandingCorrection,
  readNumericCssVar,
  SCROLL_ABORT_EVENTS,
  STICKY_STACK_HEIGHT_VAR,
} from "../utils";
import {
  LANDING_POLL_FRAMES,
  ROW_SCROLL_START_FRAMES,
  ROW_SETTLE_FRAMES,
} from "./consts";
import type { ConversationLanding, LandingContext } from "./types";

/**
 * The heading exists whether or not the section is expanded, so focus and
 * scroll land on it a frame later, after the expand has rendered.
 */
export function focusConversationHeading(): void {
  window.requestAnimationFrame(() => {
    const heading = document.getElementById("conversation-heading");
    if (!(heading instanceof HTMLElement)) return;
    heading.scrollIntoView({ block: "start" });
    heading.focus({ preventScroll: true });
  });
}

/**
 * The user's own input aborts the landing, a late focus() would yank them
 * away from wherever they moved. Returns the remover: a stale chain's
 * listeners must not survive into the next jump and cancel it.
 */
export function armLandingAbort(cancelLanding: () => void): () => void {
  for (const type of SCROLL_ABORT_EVENTS) {
    window.addEventListener(type, cancelLanding, { once: true, passive: true });
  }
  return () => {
    for (const type of SCROLL_ABORT_EVENTS) {
      window.removeEventListener(type, cancelLanding);
    }
  };
}

/**
 * Focus and flash the chunk's card. A windowed list mounts the card only as
 * the scroll approaches it, so a miss retries on the next frame.
 */
export function landOnChunkCard(
  context: LandingContext,
  chunkId: string,
  attemptsLeft: number,
): void {
  context.frameRef.current = null;
  const card = document.getElementById(chunkId);
  if (card instanceof HTMLElement) {
    card.focus({ preventScroll: true });
    context.flashTarget(card);
    return;
  }
  if (attemptsLeft <= 0) return;

  context.frameRef.current = window.requestAnimationFrame(() => {
    landOnChunkCard(context, chunkId, attemptsLeft - 1);
  });
}

/**
 * Land on the target's own row. The row renders only once the chunk is open
 * and mounted, so a miss retries before conceding to the chunk's card.
 */
export function landOnTargetRow(
  context: LandingContext,
  chunkId: string,
  target: ConversationLanding,
  attemptsLeft: number,
): void {
  context.frameRef.current = null;
  const row = findLandingRow(chunkId, target);
  if (row !== null) {
    context.cancelChunkScroll();
    // Same reduced-motion gate as every other programmatic scroll.
    row.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "center",
    });
    resolveLandingFocus(row, target).focus({ preventScroll: true });
    context.flashTarget(row);
    settleRowLanding(row, context);
    return;
  }

  const remaining = attemptsLeft - 1;
  if (remaining <= 0) {
    landOnChunkCard(context, chunkId, 0);
    return;
  }
  context.frameRef.current = window.requestAnimationFrame(() => {
    landOnTargetRow(context, chunkId, target, remaining);
  });
}

/**
 * A windowed list's measurements can kill a smooth scroll mid-flight, so once
 * the scroll stops the row gets one instant correction if it is not readable.
 * It rides the landing's frame ref, so the user's own input cancels it too.
 */
function settleRowLanding(row: HTMLElement, context: LandingContext): void {
  const { frameRef } = context;
  let framesLeft = LANDING_POLL_FRAMES;
  let framesPolled = 0;
  let hasMoved = false;
  let stillFrames = 0;
  let lastScrollY = window.scrollY;
  const poll = () => {
    frameRef.current = null;
    const scrollY = window.scrollY;
    const moved = scrollY !== lastScrollY;
    lastScrollY = scrollY;
    framesLeft -= 1;
    framesPolled += 1;

    if (moved) hasMoved = true;
    const scrollStarted = hasMoved || framesPolled > ROW_SCROLL_START_FRAMES;
    if (moved || !scrollStarted) {
      stillFrames = 0;
    } else {
      stillFrames += 1;
    }

    if (stillFrames >= ROW_SETTLE_FRAMES) {
      correctRowLanding(row);
      return;
    }
    if (framesLeft > 0) frameRef.current = window.requestAnimationFrame(poll);
  };
  frameRef.current = window.requestAnimationFrame(poll);
}

function correctRowLanding(row: HTMLElement): void {
  if (!row.isConnected) return;
  const correction = deriveRowLandingCorrection(
    row.getBoundingClientRect(),
    readNumericCssVar(STICKY_STACK_HEIGHT_VAR),
    window.innerHeight,
  );
  if (correction !== 0)
    window.scrollBy({ behavior: "instant", top: correction });
}

/**
 * A thread lands on its disclosure; a line lands on the row itself, which
 * gets a one-off tab stop only when it has none (an expanded row is
 * focusable already, a revision rail's button must keep its own).
 */
function resolveLandingFocus(
  row: HTMLElement,
  target: ConversationLanding,
): HTMLElement {
  if ("threadId" in target) return row.querySelector("button") ?? row;
  if (!row.hasAttribute("tabindex")) row.tabIndex = -1;
  return row;
}

/**
 * The landing row inside the chunk's own card: a thread renders again in
 * every sibling span that shows its line, so the search never leaves the
 * card. A line target is the row showing that side's number.
 */
function findLandingRow(
  chunkId: string,
  target: ConversationLanding,
): HTMLElement | null {
  const card = document.getElementById(chunkId);
  if (card === null) return null;
  if ("threadId" in target) {
    const row = card.querySelector(
      `[data-conversation-thread="${String(target.threadId)}"]`,
    );
    return row instanceof HTMLElement ? row : null;
  }

  return findRowByLine(card, target.side, target.line);
}
