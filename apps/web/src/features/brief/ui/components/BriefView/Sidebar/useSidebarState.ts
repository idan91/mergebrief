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
  migrateLegacySidebarPreference,
  readSidebarOverlayHint,
  readSidebarPreference,
  resolveShownPreference,
  writeSidebarOverlayHint,
  writeSidebarPreference,
} from "./storage";
import {
  SidebarSlides,
  type SidebarPreference,
  type SidebarSlide,
  type SidebarTab,
} from "./types";

export interface SidebarState {
  expanded: boolean;
  tab: SidebarTab;
  /** The panel keeps its content while it slides out. */
  panelShown: boolean;
  /**
   * The slide that is running, absent at rest. A keyboard change, reduced
   * motion and the first paint never slide.
   */
  slide: SidebarSlide | undefined;
  toggle: () => void;
  toggleInstantly: () => void;
  expand: () => void;
  collapse: () => void;
  collapseInstantly: () => void;
  selectTab: (tab: SidebarTab) => void;
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
  // Both first renders read the cookie, so the server draws the sidebar the
  // way the reader left it and hydration agrees with it.
  const [storedAtFirstRender] = useState<SidebarPreference>(
    readSidebarPreference,
  );
  const [preference, setPreference] = useState<SidebarPreference>(() =>
    resolveShownPreference(storedAtFirstRender, readSidebarOverlayHint()),
  );
  const latest = useRef(preference);
  // What the cookie holds: it differs from `latest` only while a load in the
  // overlay range keeps a stored open sidebar collapsed.
  const stored = useRef(storedAtFirstRender);
  // False until a frame after the stored preference is applied, so the first
  // paint never slides.
  const [motionReady, setMotionReady] = useState(false);
  // Tagged with the brief it opened on, so another brief reads it closed.
  const [sheetOpenFor, setSheetOpenFor] = useState<string | undefined>(
    undefined,
  );
  const [sliding, setSliding] = useState(false);
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

  // Before paint: the real viewport corrects a first render that went by the
  // last load's, and a preference from before the cookie is adopted.
  useLayoutEffect(() => {
    const read = migrateLegacySidebarPreference() ?? stored.current;
    const overlaysStory = window.matchMedia(SIDEBAR_OVERLAY_QUERY).matches;
    writeSidebarOverlayHint(overlaysStory);
    const shown = resolveShownPreference(read, overlaysStory);
    const unchanged =
      shown.expanded === latest.current.expanded &&
      shown.tab === latest.current.tab;
    stored.current = read;
    if (!unchanged) {
      latest.current = shown;
      setPreference(shown);
    }

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

      setSliding(motionReady && !instantly && !prefersReducedMotion());
      update({ expanded });
    },
    [briefId, motionReady, narrow, update],
  );

  const expanded = narrow ? sheetOpen : preference.expanded;

  useEffect(() => {
    if (!sliding) {
      return;
    }
    const slideEnd = window.setTimeout(
      () => setSliding(false),
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

  const panelShown = expanded || sliding;
  const slideDirection = expanded ? SidebarSlides.IN : SidebarSlides.OUT;
  return {
    expanded,
    panelShown,
    slide: sliding ? slideDirection : undefined,
    tab: preference.tab,
    toggle,
    toggleInstantly,
    expand,
    collapse,
    collapseInstantly,
    selectTab,
    requestRevisionRefocus,
    takeRevisionRefocus,
  };
}
