import { useCallback, useLayoutEffect, useRef, useState } from "react";

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
}

/**
 * The stored sidebar preference: read once at mount, written on every
 * change the reader makes. Force-collapsing while hidden is the caller's
 * derivation over `expanded`, never a write here.
 */
export function useSidebarState(): SidebarState {
  const [preference, setPreference] = useState<SidebarPreference>(
    DEFAULT_SIDEBAR_PREFERENCE,
  );
  const latest = useRef(preference);

  // Before paint, so a client-side navigation never flashes the default.
  useLayoutEffect(() => {
    const stored = readSidebarPreference();
    latest.current = stored;
    setPreference(stored);
  }, []);

  const update = useCallback((patch: Partial<SidebarPreference>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setPreference(next);
    writeSidebarPreference(next);
  }, []);

  const toggle = useCallback(
    () => update({ expanded: !latest.current.expanded }),
    [update],
  );
  const expand = useCallback(() => update({ expanded: true }), [update]);
  const collapse = useCallback(() => update({ expanded: false }), [update]);
  const selectTab = useCallback((tab: SidebarTab) => update({ tab }), [update]);

  return {
    expanded: preference.expanded,
    tab: preference.tab,
    toggle,
    expand,
    collapse,
    selectTab,
  };
}
