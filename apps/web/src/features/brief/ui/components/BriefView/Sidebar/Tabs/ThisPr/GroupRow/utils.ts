import type { TFunction } from "i18next";

import type { AttributedGroupView } from "../../../../../../../model/utils/view-model";

export function getChunkCountsLabel(
  t: TFunction,
  group: AttributedGroupView,
): string {
  const core = group.coreChunks.length;
  const supporting = group.supportingChunks.length;
  if (supporting === 0) {
    return t("brief.group.coreChunkCount", { core });
  }

  return t("brief.group.chunkCounts", { core, supporting });
}
