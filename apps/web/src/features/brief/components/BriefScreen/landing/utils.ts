import { prefersReducedMotion } from "@web/utils/motion";
import { CHUNK_LANDING_GAP_PX } from "../consts";
import {
  deriveGroupHeadingId,
  deriveGroupSectionId,
  readNumericCssVar,
  STICKY_STACK_HEIGHT_VAR,
} from "../utils";
import { PLACEMENT_DEFER_FRAMES } from "./consts";
import {
  LandHistories,
  LandingActionKinds,
  LandingPhases,
  LandMotions,
  LandTargetKinds,
  type ChunkLandTarget,
  type ChunkWindowsPort,
  type GroupLandTarget,
  type LandingAction,
  type LandingReading,
  type LandingState,
  type LandMotion,
  type LandOptions,
  type LandPlacement,
  type LandTarget,
  type MountedTarget,
} from "./types";

type SupportedLandTarget = ChunkLandTarget | GroupLandTarget;

/** The pinned stack's height plus the landing gap, read as one registered length. */
export function readUnderStackTop(): number {
  return readNumericCssVar(STICKY_STACK_HEIGHT_VAR) + CHUNK_LANDING_GAP_PX;
}

export function isSupportedLanding(
  target: LandTarget,
  options: LandOptions,
): target is SupportedLandTarget {
  const supportedKind =
    target.kind === LandTargetKinds.CHUNK ||
    target.kind === LandTargetKinds.GROUP;

  return (
    supportedKind &&
    options.flash !== true &&
    options.history === LandHistories.NONE
  );
}

export function deriveLandingElementId(target: SupportedLandTarget): string {
  if (target.kind === LandTargetKinds.GROUP) {
    return deriveGroupSectionId(target.groupId);
  }
  return target.chunkId;
}

/** A group lands on its section and hands focus to its heading. */
function deriveFocusElementId(target: SupportedLandTarget): string {
  if (target.kind === LandTargetKinds.GROUP) {
    return deriveGroupHeadingId(target.groupId);
  }
  return target.chunkId;
}

/** False while the element is not mounted, so the landing tries again. */
export function focusLandingTarget(target: SupportedLandTarget): boolean {
  const element = document.getElementById(deriveFocusElementId(target));
  if (element === null) {
    return false;
  }
  element.focus({ preventScroll: true });
  return true;
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
  element: HTMLElement | null,
): MountedTarget | undefined {
  if (element === null) {
    return undefined;
  }
  // Attribute check, not getClientRects: jsdom has no layout, so a rect
  // check would also veto every legitimate test scroll.
  return {
    top: element.getBoundingClientRect().top,
    hidden: element.closest("[hidden]") !== null,
  };
}

export function readLanding(elementId: string): LandingReading {
  return {
    target: readMountedTarget(document.getElementById(elementId)),
    scrollY: window.scrollY,
    viewportHeight: window.innerHeight,
    underStackTop: readUnderStackTop(),
  };
}

/** False when the action ends the landing: the windows refused the chunk. */
export function performLandingAction(
  action: LandingAction,
  target: SupportedLandTarget,
  chunkWindows: ChunkWindowsPort | undefined,
): boolean {
  const elementId = deriveLandingElementId(target);
  if (action.kind === LandingActionKinds.SCROLL_INTO_VIEW) {
    document
      .getElementById(elementId)
      ?.scrollIntoView({ behavior: action.behavior, block: "start" });
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
    const ownsChunk = target.kind === LandTargetKinds.CHUNK;
    return ownsChunk && chunkWindows?.scrollToChunk(target.chunkId) === true;
  }
  return true;
}
