import { useEffect } from "react";

import { useLatestRef } from "./useLatestRef";

/**
 * Generic scroll-spy: reports the id of the element currently crossing the
 * reading line (default 150px from the top) through `onActive` — state lives
 * with the caller (a store, not the hook), so a spy tick re-renders only the
 * caller's subscribers. Fires on changes to a non-null answer; while nothing
 * crosses the line the last answer stands. Pass an empty list to disable.
 */
export function useScrollSpy(
  ids: string[],
  onActive: (id: string) => void,
  offset = 150,
  resetKey = "",
): void {
  const onActiveRef = useLatestRef(onActive);
  // resetKey re-initialises the observer even when the id list is
  // char-identical — positional ids (c1..cN) collide across brief revisions.
  const key = `${resetKey}\n${ids.join("\n")}`;

  useEffect(() => {
    if (typeof window === "undefined" || ids.length === 0) return;
    let frame: number | null = null;
    let lastId: string | null = null;
    const update = () => {
      const current =
        ids.find((id) => {
          const element = document.getElementById(id);
          if (!element) return false;
          const rect = element.getBoundingClientRect();
          return rect.top <= offset && rect.bottom > offset;
        }) ?? null;
      if (current === lastId) return;
      lastId = current;
      if (current !== null) onActiveRef.current(current);
    };
    const scheduleUpdate = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        update();
      });
    };
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    update();
    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
    // `key` captures the id list identity without re-running on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, offset]);
}
