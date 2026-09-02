import type { GroupView } from "../../../utils/viewModel";
import { SidebarTabs, type SidebarTab } from "./types";

export function deriveGroupName(group: GroupView): string {
  return group.group.title || group.group.summary;
}

export function isSidebarTab(value: string): value is SidebarTab {
  return Object.values<string>(SidebarTabs).includes(value);
}
