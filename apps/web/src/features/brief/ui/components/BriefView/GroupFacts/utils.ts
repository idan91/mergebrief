import type { TFunction } from "i18next";

import {
  isAttributedGroupView,
  type GroupView,
} from "../../../../model/utils/view-model";

/** Whether a group counts any changed line; a remainder of flagged files alone counts none. */
export function hasChangedLines(group: GroupView): boolean {
  return group.added + group.deleted > 0;
}

/** The group's summary: the model's for an attributed group, fixed copy for the remainder. */
export function resolveGroupSummary(t: TFunction, group: GroupView): string {
  if (isAttributedGroupView(group)) {
    return group.group.summary;
  }
  if (hasChangedLines(group)) {
    return t("brief.unattributed.remainderSummary");
  }
  return t("brief.unattributed.flagsOnlySummary");
}
