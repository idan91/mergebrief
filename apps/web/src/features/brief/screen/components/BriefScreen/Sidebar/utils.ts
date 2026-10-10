import { SidebarTabs, type SidebarTab } from "./types";

export function isSidebarTab(value: string): value is SidebarTab {
  return Object.values<string>(SidebarTabs).includes(value);
}

/** A remembered Revisions tab falls back to This PR where no route offers it. */
export function resolveShownTab(
  tab: SidebarTab,
  revisionsOffered: boolean,
): SidebarTab {
  if (tab === SidebarTabs.REVISIONS && !revisionsOffered) {
    return SidebarTabs.THIS_PR;
  }
  return tab;
}
