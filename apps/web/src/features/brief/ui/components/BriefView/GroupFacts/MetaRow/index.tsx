import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { LocSign, LocSigns } from "@web/components/LocSign";
import {
  isAttributedGroupView,
  type GroupView,
} from "../../../../../model/utils/viewModel";
import { CoreLinesDisclosure } from "../../CoreLinesDisclosure";
import styles from "./MetaRow.module.scss";

export interface MetaRowProps {
  group: GroupView;
  total: number;
  /** The surface's own trailing control. */
  trailing?: ReactNode;
}

/** "Group N of M" and the group's line total: core for an attributed group. */
export function MetaRow({ group, total, trailing }: MetaRowProps) {
  const { t } = useTranslation();
  const position = t("brief.group.groupOf", { index: group.index + 1, total });
  const attributed = isAttributedGroupView(group);

  return (
    <div className={styles["metaRow"]}>
      <span className={styles["position"]}>{position}</span>
      <span className={styles["trailing"]}>
        {attributed ? (
          <CoreLinesDisclosure
            allAdded={group.added}
            allDeleted={group.deleted}
            className={styles["lines"]}
            coreAdded={group.coreAdded}
            coreDeleted={group.coreDeleted}
          >
            <LocSign sign={LocSigns.ADD} count={group.coreAdded} /> /{" "}
            <LocSign sign={LocSigns.DEL} count={group.coreDeleted} />{" "}
            {t("brief.group.coreSuffix")}
          </CoreLinesDisclosure>
        ) : (
          <span className={styles["lines"]}>
            <LocSign sign={LocSigns.ADD} count={group.added} /> /{" "}
            <LocSign sign={LocSigns.DEL} count={group.deleted} />
          </span>
        )}
        {trailing}
      </span>
    </div>
  );
}
