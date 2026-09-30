import { useCallback, useLayoutEffect, useRef, useState } from "react";

import {
  ViewportBands,
  type ViewportBand,
} from "@web/hooks/useViewportBoundary";
import {
  DEFAULT_SIDEBAR_PREFERENCE,
  readSidebarPreference,
  writeSidebarPreference,
} from "./storage";
import type { SidebarPreference, SidebarTab } from "./types";

export interface SidebarState {
  expanded: boolean;
  tab: SidebarTab;
  toggle: () => void;
  expand: () => void;
  collapse: () => void;
  selectTab: (tab: SidebarTab) => void;
  /** False until a frame after the stored preference is applied, so the first paint never animates. */
  motionReady: boolean;
  /** Marks a revision pick: the next brief's sidebar takes focus back. */
  requestRevisionRefocus: () => void;
  /** Answers the mark and clears it. */
  takeRevisionRefocus: () => boolean;
}

/**
 * The sidebar's state for the current viewport band. On desktop `expanded`
 * is the stored preference. Narrow keeps the sheet's open state for the
 * session only, always starting closed, and writes just the tab, so crossing
 * back to desktop restores what was stored. Hiding force-collapses the sheet
 * but leaves the stored preference untouched; on desktop the caller derives
 * hidden from `expanded` and never writes here.
 */
export function useSidebarState(
  band: ViewportBand,
  visible: boolean,
): SidebarState {
  const [preference, setPreference] = useState<SidebarPreference>(
    DEFAULT_SIDEBAR_PREFERENCE,
  );
  const latest = useRef(preference);
  const [motionReady, setMotionReady] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [lastBand, setLastBand] = useState(band);
  const [lastVisible, setLastVisible] = useState(visible);
  const narrow = band === ViewportBands.NARROW;

  // Crossing the breakpoint, or the sidebar leaving and returning, starts
  // from a closed sheet: a modal never reopens on its own.
  if (lastBand !== band || lastVisible !== visible) {
    setLastBand(band);
    setLastVisible(visible);
    setSheetOpen(false);
  }

  // Before paint, so a client-side navigation never flashes the default.
  useLayoutEffect(() => {
    const stored = readSidebarPreference();
    latest.current = stored;
    setPreference(stored);

    const frame = window.requestAnimationFrame(() => setMotionReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const update = useCallback((patch: Partial<SidebarPreference>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setPreference(next);
    writeSidebarPreference(next);
  }, []);

  const setExpanded = useCallback(
    (expanded: boolean) => {
      if (narrow) {
        setSheetOpen(expanded);
        return;
      }
      update({ expanded });
    },
    [narrow, update],
  );

  const expanded = narrow ? sheetOpen : preference.expanded;
  const toggle = useCallback(
    () => setExpanded(!(narrow ? sheetOpen : latest.current.expanded)),
    [narrow, setExpanded, sheetOpen],
  );
  const expand = useCallback(() => setExpanded(true), [setExpanded]);
  const collapse = useCallback(() => setExpanded(false), [setExpanded]);
  const selectTab = useCallback((tab: SidebarTab) => update({ tab }), [update]);

  // A ref, not state: the screen keys the Sidebar per brief, and only this
  // hook outlives the remount a revision pick causes.
  const revisionRefocus = useRef(false);
  const requestRevisionRefocus = useCallback(() => {
    revisionRefocus.current = true;
  }, []);
  const takeRevisionRefocus = useCallback(() => {
    const due = revisionRefocus.current;
    revisionRefocus.current = false;
    return due;
  }, []);

  return {
    expanded,
    tab: preference.tab,
    toggle,
    expand,
    collapse,
    selectTab,
    motionReady,
    requestRevisionRefocus,
    takeRevisionRefocus,
  };
}
