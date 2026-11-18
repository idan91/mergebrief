import { useSyncExternalStore } from "react";
import { REDUCED_MOTION_QUERY } from "@web/utils/motion";

function subscribe(onChange: () => void): () => void {
  const list = window.matchMedia(REDUCED_MOTION_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

function readReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function readServerReducedMotion(): boolean {
  return false;
}

/**
 * Whether the reader asks for reduced motion. The server and the hydrating
 * render read no preference, so their markup matches; the client's answer
 * lands in the render after.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    readReducedMotion,
    readServerReducedMotion,
  );
}
