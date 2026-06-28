import { useEffect, useState } from "react";

/**
 * Generic scroll-spy: returns the id of the element currently crossing the
 * reading line (default 150px from the top). Pass an empty list to disable.
 * Syncs with the scroll position — an external system — via one effect.
 */
export function useScrollSpy(ids: string[], offset = 150): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);
  const key = ids.join("\n");

  useEffect(() => {
    if (typeof window === "undefined" || ids.length === 0) return;
    const update = () => {
      const current = ids.find((id) => {
        const element = document.getElementById(id);
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return rect.top <= offset && rect.bottom > offset;
      });
      setActiveId(current ?? null);
    };
    window.addEventListener("scroll", update, { passive: true });
    update();
    return () => window.removeEventListener("scroll", update);
    // `key` captures the id list identity without re-running on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, offset]);

  return activeId;
}
