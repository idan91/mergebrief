import type { MouseEvent } from "react";
import type { ValueOf } from "types/utils";

export const SidebarTabs = {
  THIS_PR: "this-pr",
} as const;

export type SidebarTab = ValueOf<typeof SidebarTabs>;

export interface SidebarPreference {
  expanded: boolean;
  tab: SidebarTab;
}

/** A sidebar-originated jump; the event tells keyboard activation from a pointer click. */
export type JumpFromSidebar = (
  groupId: string,
  event: MouseEvent<HTMLButtonElement>,
) => void;
