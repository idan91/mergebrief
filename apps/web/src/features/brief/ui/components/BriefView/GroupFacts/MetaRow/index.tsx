import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { GroupView } from "../../../../../model/utils/view-model";
import { GroupLineTotal } from "../GroupLineTotal";
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

  return (
    <div className={styles["metaRow"]}>
      <span className={styles["position"]}>{position}</span>
      <span className={styles["trailing"]}>
        <GroupLineTotal className={styles["lines"]} group={group} />
        {trailing}
      </span>
    </div>
  );
}
