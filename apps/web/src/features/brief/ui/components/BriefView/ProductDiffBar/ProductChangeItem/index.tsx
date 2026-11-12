import { useTranslation } from "react-i18next";

import type { ProductChange } from "brief-core/types";
import { GroupJumps } from "../../GroupJumps";
import { InlineCodeText } from "../../InlineCodeText";
import { AREA_LABEL_KEYS } from "../consts";
import { BeforeText } from "./BeforeText";
import styles from "./ProductChangeItem.module.scss";

export interface ProductChangeItemProps {
  change: ProductChange;
  jumpToGroup: (groupId: string) => void;
  groupTitles: Readonly<Record<string, string>>;
}

/**
 * One Product change: its condition as the heading, then one strip split in
 * two, Before beside After, which stack on a phone.
 */
export function ProductChangeItem({
  change,
  jumpToGroup,
  groupTitles,
}: ProductChangeItemProps) {
  const { t } = useTranslation();
  const areaLabel = t(AREA_LABEL_KEYS[change.affects]);

  return (
    <li className={styles["item"]}>
      <div className={styles["head"]}>
        <h3 className={styles["when"]}>
          <InlineCodeText text={change.when} />
        </h3>
        <span className={styles["area"]}>{areaLabel}</span>
        <GroupJumps
          groupIds={change.groupIds}
          groupTitles={groupTitles}
          jumpToGroup={jumpToGroup}
        />
      </div>
      <dl className={styles["strip"]}>
        <div className={styles["before"]}>
          <dt className={styles["label"]}>{t("brief.productDiff.before")}</dt>
          <dd className={styles["text"]}>
            <BeforeText change={change} />
          </dd>
        </div>
        <div className={styles["after"]}>
          <dt className={styles["label"]}>{t("brief.productDiff.after")}</dt>
          <dd className={styles["text"]}>
            <span aria-hidden="true" className={styles["arrow"]}>
              →
            </span>
            <InlineCodeText text={change.after} />
          </dd>
        </div>
      </dl>
    </li>
  );
}
