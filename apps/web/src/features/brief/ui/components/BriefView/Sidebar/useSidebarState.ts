import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  ViewportBands,
  type ViewportBand,
} from "@web/hooks/useViewportBoundary";
import { prefersReducedMotion } from "@web/utils/motion";
import {
  SIDEBAR_OVERLAY_QUERY,
  SIDEBAR_SLIDE_IN_MS,
  SIDEBAR_SLIDE_OUT_MS,
} from "./consts";
import {
  DEFAULT_SIDEBAR_PREFERENCE,
  readSidebarPreference,
  writeSidebarPreference,
} from "./storage";
import type { SidebarPreference, SidebarTab } from "./types";

export interface SidebarState {
  expanded: boolean;
  tab: SidebarTab;
  /**
   * The width the reading column reserves: it lags `expanded` until the panel
   * has finished sliding, so the column re-lays out once.
   */
  columnExpanded: boolean;
  /** The panel keeps its content while it slides out. */
  panelShown: boolean;
  /** A slide is running. A panel a revision switch remounts never is, so it does not slide in again. */
  sliding: boolean;
  /** False when the last change came from the keyboard: that one never animates. */
  slideMotion: boolean;
  toggle: () => void;
  toggleInstantly: () => void;
  expand: () => void;
  collapse: () => void;
  collapseInstantly: () => void;
  selectTab: (tab: SidebarTab) => void;
  /** False until a frame after the stored preference is applied, so the first paint never animates. */
  motionReady: boolean;
  /** Marks a revision pick: the next brief's sidebar takes focus back. */
  requestRevisionRefocus: () => void;
  /** Answers the mark, or a brief change that closed the sheet, and clears it. */
  takeRevisionRefocus: () => boolean;
}

/**
 * The sidebar's state for the current viewport band. On desktop `expanded`
 * is the stored preference, except that a load where the panel would overlay
 * the story starts it collapsed without writing, and stays so until toggled.
 * Narrow keeps the sheet's open state for the session only, always starting
 * closed, and writes just the tab. Hiding force-collapses the sheet
 * but leaves the stored preference untouched; on desktop the caller derives
 * hidden from `expanded` and never writes here. A brief change closes the
 * sheet too, and the next brief's sidebar takes focus back.
 */
export function useSidebarState(
  band: ViewportBand,
  visible: boolean,
  briefId: string,
): SidebarState {
  const [preference, setPreference] = useState<SidebarPreference>(
    DEFAULT_SIDEBAR_PREFERENCE,
  );
  const latest = useRef(preference);
  // What storage holds: it differs from `latest` only while a load in the
  // overlay range keeps a stored open sidebar collapsed.
  const stored = useRef(preference);
  const [motionReady, setMotionReady] = useState(false);
  // Tagged with the brief it opened on, so another brief reads it closed.
  const [sheetOpenFor, setSheetOpenFor] = useState<string | undefined>(
    undefined,
  );
  const [slideMotion, setSlideMotion] = useState(true);
  // The column's reserve while the panel slides; absent at rest.
  const [slideColumn, setSlideColumn] = useState<boolean | undefined>(
    undefined,
  );
  const [lastBand, setLastBand] = useState(band);
  const [lastVisible, setLastVisible] = useState(visible);
  const [sheetClosedByBrief, setSheetClosedByBrief] = useState(false);
  const narrow = band === ViewportBands.NARROW;
  const sheetOpen = sheetOpenFor === briefId;

  // Crossing the breakpoint, or the sidebar leaving and returning, starts
  // from a closed sheet: a modal never reopens on its own.
  if (lastBand !== band || lastVisible !== visible) {
    setLastBand(band);
    setLastVisible(visible);
    setSheetOpenFor(undefined);
  }

  // A tag left by the brief before reads closed already; clearing it keeps
  // a return to that brief closed, and the next brief's sidebar takes focus.
  const sheetLeftOnEarlierBrief =
    sheetOpenFor !== undefined && sheetOpenFor !== briefId;
  useEffect(() => {
    if (!sheetLeftOnEarlierBrief) {
      return;
    }
    setSheetOpenFor(undefined);
    setSheetClosedByBrief(true);
  }, [sheetLeftOnEarlierBrief]);

  // Before paint, so a client-side navigation never flashes the default.
  useLayoutEffect(() => {
    const read = readSidebarPreference();
    const overlaysStory = window.matchMedia(SIDEBAR_OVERLAY_QUERY).matches;
    const shown = overlaysStory ? { ...read, expanded: false } : read;
    stored.current = read;
    latest.current = shown;
    setPreference(shown);

    const frame = window.requestAnimationFrame(() => setMotionReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const update = useCallback((patch: Partial<SidebarPreference>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    stored.current = { ...stored.current, ...patch };
    setPreference(next);
    writeSidebarPreference(stored.current);
  }, []);

  const setExpanded = useCallback(
    (expanded: boolean, instantly = false) => {
      if (narrow) {
        setSheetOpenFor(expanded ? briefId : undefined);
        return;
      }

      const slides = motionReady && !instantly && !prefersReducedMotion();
      const columnAtStart = latest.current.expanded;
      setSlideMotion(!instantly);
      setSlideColumn((current) =>
        slides ? (current ?? columnAtStart) : undefined,
      );
      update({ expanded });
    },
    [briefId, motionReady, narrow, update],
  );

  const expanded = narrow ? sheetOpen : preference.expanded;
  const sliding = slideColumn !== undefined;

  useEffect(() => {
    if (!sliding) {
      return;
    }
    const slideEnd = window.setTimeout(
      () => setSlideColumn(undefined),
      expanded ? SIDEBAR_SLIDE_IN_MS : SIDEBAR_SLIDE_OUT_MS,
    );
    return () => window.clearTimeout(slideEnd);
  }, [expanded, sliding]);

  const readNextExpanded = useCallback(
    () => !(narrow ? sheetOpen : latest.current.expanded),
    [narrow, sheetOpen],
  );
  const toggle = useCallback(
    () => setExpanded(readNextExpanded()),
    [readNextExpanded, setExpanded],
  );
  const toggleInstantly = useCallback(
    () => setExpanded(readNextExpanded(), true),
    [readNextExpanded, setExpanded],
  );
  const expand = useCallback(() => setExpanded(true), [setExpanded]);
  const collapse = useCallback(() => setExpanded(false), [setExpanded]);
  const collapseInstantly = useCallback(
    () => setExpanded(false, true),
    [setExpanded],
  );
  const selectTab = useCallback((tab: SidebarTab) => update({ tab }), [update]);

  // A ref, not state: the screen keys the Sidebar per brief, and only this
  // hook outlives the remount a revision pick causes.
  const revisionRefocus = useRef(false);
  const requestRevisionRefocus = useCallback(() => {
    revisionRefocus.current = true;
  }, []);
  const takeRevisionRefocus = useCallback(() => {
    const due = revisionRefocus.current || sheetClosedByBrief;
    revisionRefocus.current = false;
    setSheetClosedByBrief(false);
    return due;
  }, [sheetClosedByBrief]);

  const columnExpanded = slideColumn ?? expanded;
  const panelShown = expanded || sliding;
  return {
    expanded,
    columnExpanded,
    panelShown,
    sliding,
    slideMotion,
    tab: preference.tab,
    toggle,
    toggleInstantly,
    expand,
    collapse,
    collapseInstantly,
    selectTab,
    motionReady,
    requestRevisionRefocus,
    takeRevisionRefocus,
  };
}
