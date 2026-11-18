import { useTranslation } from "react-i18next";

import type { ProductChange } from "brief-core/types";
import { GroupJumps } from "../../GroupJumps";
import { InlineCodeText } from "../../InlineCodeText";
import { AREA_LABEL_KEYS } from "../consts";
import { capitalizeCondition, hasOwnConnective, stripWhenLead } from "../utils";
import { BeforeText } from "./BeforeText";
import styles from "./ProductChangeItem.module.scss";

export interface ProductChangeItemProps {
  change: ProductChange;
  jumpToGroup: (groupId: string) => void;
  groupTitles: Readonly<Record<string, string>>;
}

/**
 * One Product change in one frame: its condition as the heading band, led by
 * "When" unless it opens with a connective of its own, over a strip split in
 * two, Before beside After, which stack on a phone.
 */
export function ProductChangeItem({
  change,
  jumpToGroup,
  groupTitles,
}: ProductChangeItemProps) {
  const { t } = useTranslation();
  const areaLabel = t(AREA_LABEL_KEYS[change.affects]);
  const condition = stripWhenLead(change.when);
  const leadsItself = hasOwnConnective(condition);
  const headingText = leadsItself ? capitalizeCondition(condition) : condition;

  return (
    <li className={styles["item"]}>
      <div className={styles["head"]}>
        <h3 className={styles["when"]}>
          {leadsItself ? null : (
            <>
              <span className={styles["lead"]}>
                {t("brief.productDiff.whenLead")}
              </span>{" "}
            </>
          )}
          <InlineCodeText text={headingText} />
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
