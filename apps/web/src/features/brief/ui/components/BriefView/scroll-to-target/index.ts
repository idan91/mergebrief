import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import { useLatestRef } from "@web/hooks/useLatestRef";
import { armScrollAbort } from "./engine/abort";
import {
  deriveScrollBehavior,
  planScrollFrame,
  startScrollState,
} from "./engine/plan";
import {
  ScrollPhases,
  ScrollPlacements,
  type ScrollRequest,
  type ScrollState,
} from "./engine/types";
import { createFlash, startFlash, stopFlash } from "./flash";
import {
  deriveTargetChunkId,
  findFallbackCard,
  focusScrollTarget,
  performScrollAction,
  readScrollState,
  refindScrollElement,
} from "./targets";
import {
  ScrollHistories,
  type ChunkWindowsPort,
  type Flash,
  type ParkedScroll,
  type ScrollTarget,
  type ScrollTargetOptions,
  type ScrollToTarget,
  type UseScrollToTargetInput,
} from "./types";

interface Flight {
  timeout: number | undefined;
  frame: number | undefined;
  /** Removes the user-input abort listeners once the watch has armed them. */
  removeAbort: (() => void) | undefined;
  /** Ends the windows' mark of a smooth scroll in flight. */
  endSmoothScroll: (() => void) | undefined;
}

/** What every scroll of one hook shares. */
interface ScrollDeps {
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
  flight.endSmoothScroll?.();
  flight.endSmoothScroll = undefined;
}

/**
 * Runs once, on the first step that finds the target. Never inside `scrollToTarget`:
 * the caller's own state change has not committed yet, and a card it is about
 * to reveal is still unrendered, so focus would be silently dropped.
 */
function arriveAt(
  target: ScrollTarget,
  options: ScrollTargetOptions,
  element: HTMLElement,
  flash: Flash,
): void {
  if (options.focus === true) {
    focusScrollTarget(target, element);
  }
  if (options.flash === true) {
    startFlash(flash, element);
  }
}

/**
 * The jump waits a task (and two frames under the stack), then each frame
 * reads, plans and acts until the plan ends or the hook cancels.
 */
function launchScroll(
  target: ScrollTarget,
  options: ScrollTargetOptions,
  deps: ScrollDeps,
): void {
  deps.cancel();
  const chunkId = deriveTargetChunkId(target);
  const opensChunk = options.open === true && chunkId !== undefined;
  if (opensChunk) {
    deps.openChunk(chunkId);
  }

  const placement = options.placement ?? ScrollPlacements.VIEWPORT_TOP;
  const request: ScrollRequest = {
    placement,
    behavior: deriveScrollBehavior(options.motion),
  };
  let state: ScrollState = startScrollState(placement);
  let element: HTMLElement | undefined;
  let arrived = false;

  const flight: Flight = {
    timeout: undefined,
    frame: undefined,
    removeAbort: undefined,
    endSmoothScroll: undefined,
  };
  if (request.behavior === "smooth") {
    flight.endSmoothScroll = deps.chunkWindows?.beginSmoothScroll();
  }
  deps.flightRef.current = flight;
  const launchedFor = deps.liveBriefId.current;
  const end = () => {
    deps.cancel();
    const card = findFallbackCard(target, arrived);
    if (card !== undefined) {
      const cardOptions = {
        ...options,
        placement: ScrollPlacements.UNDER_STACK,
      };
      launchScroll(card, cardOptions, deps);
    }
  };

  const step = () => {
    flight.timeout = undefined;
    flight.frame = undefined;
    if (deps.liveBriefId.current !== launchedFor) {
      deps.cancel();
      return;
    }
    const found = refindScrollElement(target, element);
    element = found;
    const firstArrival = found !== undefined && !arrived;
    if (firstArrival) {
      arrived = true;
      arriveAt(target, options, found, deps.flash);
    }

    const plan = planScrollFrame(state, readScrollState(element), request);
    const input = { element, chunkId, chunkWindows: deps.chunkWindows };
    const kept = performScrollAction(plan.action, input);
    const { next } = plan;
    const ended = !kept || next === undefined;
    if (ended) {
      end();
      return;
    }

    const watching = next.phase === ScrollPhases.SETTLE;
    const armsAbort = watching && flight.removeAbort === undefined;
    if (armsAbort) {
      flight.removeAbort = armScrollAbort(deps.cancel);
    }
    state = next;
    flight.frame = window.requestAnimationFrame(step);
  };
  flight.timeout = window.setTimeout(step, 0);
}

/**
 * One scroll at a time: a second `scrollToTarget` replaces the first, a
 * brief switch or the reader's own wheel, touch or key drops it, and a brief
 * switch also clears the flash. A row that never renders concedes to its
 * card. In Changes scope a scroll with a history mode parks, leaves the scope
 * in that mode and runs once the story pane renders; parked counts as the
 * one scroll, so a newer one or a brief switch drops it. After unmount
 * `scrollToTarget` refuses, so a late caller never navigates from a page that is gone.
 */
export function useScrollToTarget({
  briefId,
  chunkWindows,
  openChunk,
  inChangesScope,
  exitChangesScope,
}: UseScrollToTargetInput): ScrollToTarget {
  const flightRef = useRef<Flight | undefined>(undefined);
  // A step can run before the brief-switch cleanup does; it checks the id itself.
  const liveBriefId = useRef(briefId);
  liveBriefId.current = briefId;
  const parkedRef = useRef<ParkedScroll | undefined>(undefined);
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
    (target: ScrollTarget, options: ScrollTargetOptions) => {
      launchScroll(target, options, {
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

  const scrollToTarget = useCallback<ScrollToTarget["scrollToTarget"]>(
    (target, options) => {
      if (!mountedRef.current) {
        return false;
      }
      const leavesScope =
        options.history !== ScrollHistories.NONE && inChangesScopeRef.current;
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
      exit({ replace: options.history === ScrollHistories.REPLACE });
      return true;
    },
    [cancel, exitChangesScopeRef, inChangesScopeRef, launch],
  );

  return { scrollToTarget };
}
