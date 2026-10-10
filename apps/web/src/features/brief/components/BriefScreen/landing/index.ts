import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import { planLanding } from "./plan";
import {
  LandingPhases,
  LandPlacements,
  type ChunkWindowsPort,
  type Flash,
  type Landing,
  type LandingRequest,
  type LandingState,
  type LandOptions,
  type LandTarget,
  type UseLandingInput,
} from "./types";
import {
  armLandingAbort,
  createFlash,
  deriveScrollBehavior,
  deriveTargetChunkId,
  findFallbackCard,
  focusLandingTarget,
  isSupportedLanding,
  performLandingAction,
  readLanding,
  refindLandingElement,
  startFlash,
  startLanding,
  stopFlash,
} from "./utils";

interface Flight {
  timeout: number | undefined;
  frame: number | undefined;
  /** Removes the user-input abort listeners once the watch has armed them. */
  removeAbort: (() => void) | undefined;
}

/** What every landing of one hook shares. */
interface LandingDeps {
  flightRef: RefObject<Flight | undefined>;
  liveBriefId: RefObject<string>;
  flash: Flash;
  chunkWindows: ChunkWindowsPort | undefined;
  openChunk: (chunkId: string) => void;
  cancel: () => void;
}

function stopFlight(flight: Flight): void {
  if (flight.timeout !== undefined) {
    window.clearTimeout(flight.timeout);
    flight.timeout = undefined;
  }
  if (flight.frame !== undefined) {
    window.cancelAnimationFrame(flight.frame);
    flight.frame = undefined;
  }
  flight.removeAbort?.();
  flight.removeAbort = undefined;
}

/**
 * Runs once, on the first step that finds the target. Never inside `land`:
 * the caller's own state change has not committed yet, and a card it is about
 * to reveal is still unrendered, so focus would be silently dropped.
 */
function arriveAt(
  target: LandTarget,
  options: LandOptions,
  element: HTMLElement,
  flash: Flash,
): void {
  if (options.focus === true) {
    focusLandingTarget(target, element);
  }
  if (options.flash === true) {
    startFlash(flash, element);
  }
}

/**
 * The jump waits a task (and two frames under the stack), then each frame
 * reads, plans and acts until the plan ends or the hook cancels.
 */
function launchLanding(
  target: LandTarget,
  options: LandOptions,
  deps: LandingDeps,
): void {
  deps.cancel();
  const chunkId = deriveTargetChunkId(target);
  if (options.open === true && chunkId !== undefined) {
    deps.openChunk(chunkId);
  }

  const placement = options.placement ?? LandPlacements.VIEWPORT_TOP;
  const request: LandingRequest = {
    placement,
    behavior: deriveScrollBehavior(options.motion),
  };
  let state: LandingState = startLanding(placement);
  let element: HTMLElement | undefined;
  let arrived = false;

  const flight: Flight = {
    timeout: undefined,
    frame: undefined,
    removeAbort: undefined,
  };
  deps.flightRef.current = flight;
  const launchedFor = deps.liveBriefId.current;
  const end = () => {
    deps.cancel();
    const card = findFallbackCard(target, arrived);
    if (card !== undefined) {
      const cardOptions = { ...options, placement: LandPlacements.UNDER_STACK };
      launchLanding(card, cardOptions, deps);
    }
  };

  const step = () => {
    flight.timeout = undefined;
    flight.frame = undefined;
    if (deps.liveBriefId.current !== launchedFor) {
      deps.cancel();
      return;
    }
    element = refindLandingElement(target, element);
    if (element !== undefined && !arrived) {
      arrived = true;
      arriveAt(target, options, element, deps.flash);
    }

    const plan = planLanding(state, readLanding(element), request);
    const input = { element, chunkId, chunkWindows: deps.chunkWindows };
    const kept = performLandingAction(plan.action, input);
    if (!kept || plan.next === undefined) {
      end();
      return;
    }

    const watching = plan.next.phase === LandingPhases.SETTLE;
    if (watching && flight.removeAbort === undefined) {
      flight.removeAbort = armLandingAbort(deps.cancel);
    }
    state = plan.next;
    flight.frame = window.requestAnimationFrame(step);
  };
  flight.timeout = window.setTimeout(step, 0);
}

/**
 * One landing at a time: a second `land` replaces the first, a brief switch
 * or the reader's own wheel, touch or key drops it, and a brief switch also
 * clears the flash. A row that never renders lands on its card instead.
 */
export function useLanding({
  briefId,
  chunkWindows,
  openChunk,
}: UseLandingInput): Landing {
  const flightRef = useRef<Flight | undefined>(undefined);
  // A step can run before the brief-switch cleanup does; it checks the id itself.
  const liveBriefId = useRef(briefId);
  liveBriefId.current = briefId;
  const [flash] = useState(createFlash);

  const cancel = useCallback(() => {
    if (flightRef.current === undefined) {
      return;
    }
    stopFlight(flightRef.current);
    flightRef.current = undefined;
  }, []);
  useEffect(
    () => () => {
      cancel();
      stopFlash(flash);
    },
    [briefId, cancel, flash],
  );

  const land = useCallback<Landing["land"]>(
    (target, options) => {
      if (!isSupportedLanding(options)) {
        return false;
      }
      launchLanding(target, options, {
        flightRef,
        liveBriefId,
        flash,
        chunkWindows,
        openChunk,
        cancel,
      });
      return true;
    },
    [cancel, chunkWindows, flash, openChunk],
  );

  return { land };
}
