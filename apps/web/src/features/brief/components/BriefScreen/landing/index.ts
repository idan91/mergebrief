import { useCallback, useEffect, useRef } from "react";

import { armLandingAbort } from "../useConversationWiring/utils";
import { planLanding } from "./plan";
import {
  LandingPhases,
  LandPlacements,
  LandTargetKinds,
  type Landing,
  type LandingRequest,
  type LandingState,
  type UseLandingInput,
} from "./types";
import {
  deriveLandingElementId,
  deriveScrollBehavior,
  focusLandingTarget,
  isSupportedLanding,
  performLandingAction,
  readLanding,
  startLanding,
} from "./utils";

interface Flight {
  timeout: number | undefined;
  frame: number | undefined;
  /** Removes the user-input abort listeners once the watch has armed them. */
  removeAbort: (() => void) | undefined;
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
 * One landing at a time: a second `land` replaces the first, a brief switch
 * or the reader's own wheel, touch or key drops it. The jump waits a task
 * (and two frames under the stack, for the focus pill), then the target is
 * watched until it rests where it belongs.
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

  const cancel = useCallback(() => {
    if (flightRef.current === undefined) {
      return;
    }
    stopFlight(flightRef.current);
    flightRef.current = undefined;
  }, []);
  useEffect(() => cancel, [briefId, cancel]);

  const land = useCallback<Landing["land"]>(
    (target, options) => {
      if (!isSupportedLanding(target, options)) {
        return false;
      }
      cancel();

      if (options.open === true && target.kind === LandTargetKinds.CHUNK) {
        openChunk(target.chunkId);
      }
      let focusPending = options.focus === true && !focusLandingTarget(target);
      const placement = options.placement ?? LandPlacements.VIEWPORT_TOP;
      const request: LandingRequest = {
        placement,
        behavior: deriveScrollBehavior(options.motion),
      };
      const elementId = deriveLandingElementId(target);
      let state: LandingState = startLanding(placement);
      const flight: Flight = {
        timeout: undefined,
        frame: undefined,
        removeAbort: undefined,
      };
      flightRef.current = flight;
      const launchedFor = liveBriefId.current;

      const step = () => {
        flight.timeout = undefined;
        flight.frame = undefined;
        if (liveBriefId.current !== launchedFor) {
          cancel();
          return;
        }
        const reading = readLanding(elementId);
        if (focusPending && reading.target !== undefined) {
          focusPending = !focusLandingTarget(target);
        }

        const plan = planLanding(state, reading, request);
        const kept = performLandingAction(plan.action, target, chunkWindows);
        if (!kept || plan.next === undefined) {
          cancel();
          return;
        }

        const watching = plan.next.phase === LandingPhases.SETTLE;
        if (watching && flight.removeAbort === undefined) {
          flight.removeAbort = armLandingAbort(cancel);
        }
        state = plan.next;
        flight.frame = window.requestAnimationFrame(step);
      };
      flight.timeout = window.setTimeout(step, 0);
      return true;
    },
    [cancel, chunkWindows, openChunk],
  );

  return { land, cancel };
}
