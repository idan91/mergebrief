import { useTranslation } from "react-i18next";

import { LocSign, LocSigns } from "@web/components/LocSign";
import {
  isAttributedGroupView,
  type GroupView,
} from "../../../../../model/utils/view-model";
import { CoreLinesDisclosure } from "../../CoreLinesDisclosure";
import { hasLineTotal } from "../utils";

export interface GroupLineTotalProps {
  group: GroupView;
  /** The surface's own look for the figure. */
  className?: string | undefined;
}

/** A group's line total: core lines for an attributed group, every line for the remainder. */
export function GroupLineTotal({ group, className }: GroupLineTotalProps) {
  const { t } = useTranslation();

  if (!hasLineTotal(group)) {
    return null;
  }
  if (isAttributedGroupView(group)) {
    return (
      <CoreLinesDisclosure
        allAdded={group.added}
        allDeleted={group.deleted}
        className={className}
        coreAdded={group.coreAdded}
        coreDeleted={group.coreDeleted}
      >
        <LocSign sign={LocSigns.ADD} count={group.coreAdded} /> /{" "}
        <LocSign sign={LocSigns.DEL} count={group.coreDeleted} />{" "}
        {t("brief.group.coreSuffix")}
      </CoreLinesDisclosure>
    );
  }
  return (
    <span className={className}>
      <LocSign sign={LocSigns.ADD} count={group.added} /> /{" "}
      <LocSign sign={LocSigns.DEL} count={group.deleted} />
    </span>
  );
}
