import type { TFunction } from "i18next";

import type { GroupView } from "../../../utils/viewModel";

export interface FocusCount {
  position: number;
  total: number;
}

export function deriveFocusCount(
  groups: GroupView[],
  activeGroupId: string | null,
): FocusCount | undefined {
  const index = groups.findIndex((group) => group.id === activeGroupId);
  const group = groups[index];
  if (!group) {
    return undefined;
  }

  return {
    position: index + 1,
    total: groups.length,
  };
}

export function describeFocusCount(t: TFunction, count: FocusCount): string {
  return t("brief.focusIndicator.groupOf", {
    index: count.position,
    total: count.total,
  });
}
