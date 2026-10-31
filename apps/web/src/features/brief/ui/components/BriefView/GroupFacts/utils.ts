import type { TFunction } from "i18next";

import {
  hasChangedLines,
  isAttributedGroupView,
  type GroupView,
} from "../../../../model/utils/view-model";

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
