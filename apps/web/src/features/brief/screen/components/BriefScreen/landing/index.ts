import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import { useLatestRef } from "@web/hooks/useLatestRef";
import { planLanding } from "./plan";
import {
  LandHistories,
  LandingPhases,
  LandPlacements,
  type ChunkWindowsPort,
  type Flash,
  type Landing,
  type LandingRequest,
  type LandingState,
  type LandOptions,
  type LandTarget,
  type ParkedLanding,
  type UseLandingInput,
} from "./types";
import {
  armLandingAbort,
  createFlash,
  deriveScrollBehavior,
  deriveTargetChunkId,
  findFallbackCard,
  focusLandingTarget,
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
  const opensChunk = options.open === true && chunkId !== undefined;
  if (opensChunk) {
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
    const found = refindLandingElement(target, element);
    element = found;
    const firstArrival = found !== undefined && !arrived;
    if (firstArrival) {
      arrived = true;
      arriveAt(target, options, found, deps.flash);
    }

    const plan = planLanding(state, readLanding(element), request);
    const input = { element, chunkId, chunkWindows: deps.chunkWindows };
    const kept = performLandingAction(plan.action, input);
    const { next } = plan;
    const ended = !kept || next === undefined;
    if (ended) {
      end();
      return;
    }

    const watching = next.phase === LandingPhases.SETTLE;
    const armsAbort = watching && flight.removeAbort === undefined;
    if (armsAbort) {
      flight.removeAbort = armLandingAbort(deps.cancel);
    }
    state = next;
    flight.frame = window.requestAnimationFrame(step);
  };
  flight.timeout = window.setTimeout(step, 0);
}

/**
 * One landing at a time: a second `land` replaces the first, a brief switch
 * or the reader's own wheel, touch or key drops it, and a brief switch also
 * clears the flash. A row that never renders lands on its card instead.
 * In Changes scope a landing with a history mode parks, leaves the scope in
 * that mode and lands once the story pane renders; parked counts as the one
 * landing, so a newer one or a brief switch drops it. After unmount `land`
 * refuses, so a late caller never navigates from a page that is gone.
 */
export function useLanding({
  briefId,
  chunkWindows,
  openChunk,
  inChangesScope,
  exitChangesScope,
}: UseLandingInput): Landing {
  const flightRef = useRef<Flight | undefined>(undefined);
  // A step can run before the brief-switch cleanup does; it checks the id itself.
  const liveBriefId = useRef(briefId);
  liveBriefId.current = briefId;
  const parkedRef = useRef<ParkedLanding | undefined>(undefined);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const inChangesScopeRef = useLatestRef(inChangesScope);
  const exitChangesScopeRef = useLatestRef(exitChangesScope);
  const [flash] = useState(createFlash);

  const cancel = useCallback(() => {
    parkedRef.current = undefined;
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

  const launch = useCallback(
    (target: LandTarget, options: LandOptions) => {
      launchLanding(target, options, {
        flightRef,
        liveBriefId,
        flash,
        chunkWindows,
        openChunk,
        cancel,
      });
    },
    [cancel, chunkWindows, flash, openChunk],
  );

  useEffect(() => {
    const parked = parkedRef.current;
    const nothingToLaunch = inChangesScope || parked === undefined;
    if (nothingToLaunch) {
      return;
    }
    launch(parked.target, parked.options);
  }, [inChangesScope, launch]);

  const land = useCallback<Landing["land"]>(
    (target, options) => {
      if (!mountedRef.current) {
        return false;
      }
      const leavesScope =
        options.history !== LandHistories.NONE && inChangesScopeRef.current;
      if (!leavesScope) {
        launch(target, options);
        return true;
      }
      const exit = exitChangesScopeRef.current;
      if (exit === undefined) {
        return false;
      }

      cancel();
      parkedRef.current = { target, options };
      exit({ replace: options.history === LandHistories.REPLACE });
      return true;
    },
    [cancel, exitChangesScopeRef, inChangesScopeRef, launch],
  );

  return { land };
}
