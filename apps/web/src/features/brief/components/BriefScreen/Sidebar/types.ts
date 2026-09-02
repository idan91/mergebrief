import type { ValueOf } from "types";

export const SidebarTabs = {
  THIS_PR: "this-pr",
} as const;

export type SidebarTab = ValueOf<typeof SidebarTabs>;

export interface SidebarPreference {
  expanded: boolean;
  tab: SidebarTab;
}
