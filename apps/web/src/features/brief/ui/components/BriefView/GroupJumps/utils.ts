import type { TFunction } from "i18next";

export interface GroupJump {
  groupId: string;
  label: string;
}

/** One jump per change-group a row names, labelled with the group's title when the brief has one. */
export function listGroupJumps(
  t: TFunction,
  groupIds: readonly string[],
  groupTitles: Readonly<Record<string, string>>,
): GroupJump[] {
  return groupIds.map((groupId) => {
    const title = groupTitles[groupId];
    const label =
      title === undefined
        ? t("brief.jumpToGroup", { groupId })
        : t("brief.jumpToGroupTitled", { groupId, title });
    return { groupId, label };
  });
}
