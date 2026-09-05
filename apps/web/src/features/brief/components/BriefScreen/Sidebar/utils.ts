import { SidebarTabs, type SidebarTab } from "./types";

export function isSidebarTab(value: string): value is SidebarTab {
  return Object.values<string>(SidebarTabs).includes(value);
}
