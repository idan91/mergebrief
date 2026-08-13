import { useEffect, useRef, useState } from "react";

/** Indicator appears only when the wait outlasts this — fast loads show nothing. */
export const PENDING_APPEAR_MS = 180;

/** Once shown, the indicator holds at least this long — never a flicker. */
export const PENDING_MIN_HOLD_MS = 250;

/**
 * Delayed-pending gate for slow transitions: `true` only when `pending` has
 * outlasted PENDING_APPEAR_MS, and once true it stays for PENDING_MIN_HOLD_MS
 * even if `pending` resolves sooner.
 */
export function useDelayedPending(pending: boolean): boolean {
  const [shown, setShown] = useState(false);
  const shownAtRef = useRef(0);

  useEffect(() => {
    if (pending) {
      // Already shown: the episode's appear timer has done its job — arming
      // another would overwrite shownAt and stretch the hold past its spec.
      if (shown) return undefined;
      const timer = window.setTimeout(() => {
        shownAtRef.current = Date.now();
        setShown(true);
      }, PENDING_APPEAR_MS);
      return () => {
        window.clearTimeout(timer);
      };
    }
    if (!shown) return undefined;
    const remaining = PENDING_MIN_HOLD_MS - (Date.now() - shownAtRef.current);
    if (remaining <= 0) {
      setShown(false);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setShown(false);
    }, remaining);
    return () => {
      window.clearTimeout(timer);
    };
  }, [pending, shown]);

  return shown;
}
