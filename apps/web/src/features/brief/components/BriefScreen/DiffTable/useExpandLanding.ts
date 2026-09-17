import type { TFunction } from "i18next";
import { type RefObject, useLayoutEffect, useRef } from "react";

import type { DiffLine } from "@web/utils/diffTokens/types";
import type { ExpandedEvent } from "./ExpandControl/ExpandControl";
import { focusExpandedLine } from "./utils";

export interface ExpandLandingInput {
  rows: DiffLine[];
  tableRef: RefObject<HTMLTableElement | null>;
  announce: (message: string) => void;
  t: TFunction;
}

/**
 * What a click just expanded, settled in a layout effect once the rows
 * land: the control's row keeps its viewport top, or, when the row went
 * with the closed gap, focus moves onto the first line that arrived.
 * Registered at click time, before the read: the store write that lands
 * the rows renders synchronously, and the layout effect must find it then.
 */
export function useExpandLanding({
  rows,
  tableRef,
  announce,
  t,
}: ExpandLandingInput) {
  const landingRef = useRef<ExpandedEvent | null>(null);
  const landingTopRef = useRef(0);

  useLayoutEffect(() => {
    const landing = landingRef.current;
    if (landing === null) return;
    landingRef.current = null;
    const count = landing.range.end - landing.range.start + 1;
    const row = landing.row;
    const anchored = row !== null && row.isConnected;
    if (anchored) {
      const delta = row.getBoundingClientRect().top - landingTopRef.current;
      if (delta !== 0) window.scrollBy({ top: delta, behavior: "instant" });
    }
    // A spent edge unmounts its control while its row stays, so focus is
    // checked against the row, not the row against the document. An
    // anchored row keeps its viewport: the focus must not scroll again.
    const kept = row?.contains(document.activeElement) === true;
    if (!kept) {
      focusExpandedLine(tableRef.current, landing.range.start, {
        preventScroll: anchored,
      });
    }
    if (count > 0) announce(t("brief.diff.expandShown", { count }));
  }, [rows, announce, t, tableRef]);

  const handleExpanded = (event: ExpandedEvent) => {
    landingTopRef.current = event.top;
    landingRef.current = event;
  };
  const handleAbandoned = (edgeKey: string) => {
    if (landingRef.current?.edgeKey === edgeKey) landingRef.current = null;
  };

  return { handleExpanded, handleAbandoned };
}
