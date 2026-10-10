import type { TFunction } from "i18next";

import { GroupViewKinds } from "./remainder";
import type { GroupView } from "./viewModel";

export function resolveGroupName(t: TFunction, view: GroupView): string {
  if (view.kind === GroupViewKinds.UNATTRIBUTED_REMAINDER) {
    return t("brief.unattributed.remainderTitle");
  }
  return view.group.title || view.group.summary;
}
