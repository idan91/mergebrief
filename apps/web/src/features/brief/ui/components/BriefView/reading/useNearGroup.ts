import { useCallback, useEffect, useRef, useState } from "react";

/** Viewport heights on each side within which a group keeps its cards mounted. */
const NEAR_GROUP_MARGIN = "200% 0px";

export interface NearGroup {
  /** False while the group sits far from the viewport. */
  near: boolean;
  /** The key the last jump into this group named, while it stays pinned. */
  jumpKey: string | undefined;
  /**
   * Pins `key` and marks the group near, so a jump into a far group finds
   * its card without waiting on the observer. The pin holds until the group
   * has been reached and left, or the next jump into this group.
   */
  pinJump: (key: string) => void;
}

/**
 * Whether a group's list sits within two viewports of the screen. The first
 * render is near on the server and the client alike; only the observer,
 * after hydration, turns a far group off. A hidden pane reports every group
 * far, so the observer lives only while the pane is active and is rebuilt on
 * each unhide, whose first entry gives the true state; `liveActive` drops an
 * entry delivered after the pane hid.
 */
export function useNearGroup(
  listEl: HTMLElement | null,
  active: boolean,
  liveActive: { readonly current: { readonly active: boolean } },
): NearGroup {
  const [near, setNear] = useState(true);
  const [jumpKey, setJumpKey] = useState<string | undefined>(undefined);
  const jumpLanded = useRef(false);
  const intersecting = useRef(false);

  useEffect(() => {
    const canObserve =
      listEl !== null && active && typeof IntersectionObserver !== "undefined";
    if (!canObserve) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        const staleEntry = entry === undefined || !liveActive.current.active;
        if (staleEntry) {
          return;
        }
        setNear(entry.isIntersecting);
        intersecting.current = entry.isIntersecting;
        if (entry.isIntersecting) {
          jumpLanded.current = true;
          return;
        }
        if (jumpLanded.current) {
          jumpLanded.current = false;
          setJumpKey(undefined);
        }
      },
      { rootMargin: NEAR_GROUP_MARGIN },
    );
    observer.observe(listEl);
    return () => observer.disconnect();
  }, [listEl, active, liveActive]);

  const pinJump = useCallback((key: string) => {
    jumpLanded.current = intersecting.current;
    setJumpKey(key);
    setNear(true);
  }, []);

  return { near, jumpKey, pinJump };
}
