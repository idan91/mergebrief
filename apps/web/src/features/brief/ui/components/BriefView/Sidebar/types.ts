import type { MouseEvent } from "react";
import type { ValueOf } from "types/utils";

export const SidebarTabs = {
  THIS_PR: "this-pr",
  REVISIONS: "revisions",
} as const;

export type SidebarTab = ValueOf<typeof SidebarTabs>;

/** Which way the panel is sliding; the page eases its reserve with it. */
export const SidebarSlides = {
  IN: "in",
  OUT: "out",
} as const;

export type SidebarSlide = ValueOf<typeof SidebarSlides>;

export interface SidebarPreference {
  expanded: boolean;
  tab: SidebarTab;
}

/** A sidebar-originated jump; the event tells keyboard activation from a pointer click. */
export type JumpFromSidebar = (
  groupId: string,
  event: MouseEvent<HTMLButtonElement>,
) => void;

/** A chunk jump from the Sidebar sheet, with the same event contract as a group's. */
export type JumpChunkFromSidebar = (
  chunkId: string,
  event: MouseEvent<HTMLButtonElement>,
) => void;
