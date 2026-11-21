import { useTranslation } from "react-i18next";

import { readUnmetConditionKey } from "../../held-head";
import type { HeldAnyGroup } from "../../held-head/types";
import { ConditionItem } from "../ConditionItem";
import styles from "./AnyGroupItem.module.scss";

export interface AnyGroupItemProps {
  group: HeldAnyGroup;
}

/** An `any` group: one passing member is enough, so its members nest under one line. */
export function AnyGroupItem({ group }: AnyGroupItemProps) {
  const { t } = useTranslation();

  return (
    <li className={styles["group"]} data-testid="held-any-group">
      <span className={styles["lead"]}>{t("triggerCondition.anyGroup")}</span>
      <ul className={styles["members"]}>
        {group.conditions.map((member) => (
          <ConditionItem
            condition={member}
            key={readUnmetConditionKey(member)}
          />
        ))}
      </ul>
    </li>
  );
}
