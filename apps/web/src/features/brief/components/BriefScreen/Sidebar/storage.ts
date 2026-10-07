import { z } from "zod/v4";

import { SidebarTabs, type SidebarPreference } from "./types";

export const SIDEBAR_STORAGE_KEY = "mergebrief.sidebar";

export const DEFAULT_SIDEBAR_PREFERENCE: SidebarPreference = {
  expanded: false,
  tab: SidebarTabs.THIS_PR,
};

// Each field falls back on its own: a remembered tab this build no longer
// ships must not also forget whether the sidebar was open.
const sidebarPreferenceSchema = z.object({
  expanded: z.boolean().catch(DEFAULT_SIDEBAR_PREFERENCE.expanded),
  tab: z.enum(SidebarTabs).catch(DEFAULT_SIDEBAR_PREFERENCE.tab),
});

export function readSidebarPreference(): SidebarPreference {
  if (typeof window === "undefined") {
    return DEFAULT_SIDEBAR_PREFERENCE;
  }

  try {
    const raw = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_SIDEBAR_PREFERENCE;
    }

    const parsed = sidebarPreferenceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_SIDEBAR_PREFERENCE;
  } catch {
    return DEFAULT_SIDEBAR_PREFERENCE;
  }
}

export function writeSidebarPreference(preference: SidebarPreference): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify(preference),
    );
  } catch {
    // Storage denied (private mode, quota): the choice still holds for this page.
  }
}
