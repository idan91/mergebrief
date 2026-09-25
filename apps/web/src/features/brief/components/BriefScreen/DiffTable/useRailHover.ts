import { useEffect, useRef, useState } from "react";

import type { ComparisonRun } from "../../../comparison/runs";

export interface RailHover {
  run: ComparisonRun;
  el: HTMLElement;
  key: number;
}

/**
 * The revision rail's hovered run and the cell it belongs to. Mouse-leave is
 * owned by the callout's hover system (safePolygon), so the pointer can
 * travel into the callout; the close here is the keyboard path (blur), and
 * a close names its anchor because the previous cell's leave lands after
 * the next cell's enter.
 */
export function useRailHover() {
  const [railHover, setRailHover] = useState<RailHover | null>(null);
  const railHoverSeq = useRef(0);

  useEffect(() => {
    if (!railHover) return;
    const close = () => setRailHover(null);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [railHover]);

  const handleRailEnter = (run: ComparisonRun, el: HTMLElement) => {
    railHoverSeq.current += 1;
    setRailHover({ run, el, key: railHoverSeq.current });
  };
  const handleRailLeave = (el: HTMLElement) =>
    setRailHover((current) => (current?.el === el ? null : current));

  return { railHover, handleRailEnter, handleRailLeave };
}
