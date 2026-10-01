import { useTranslation } from "react-i18next";

import {
  type AttributedGroupView,
  categoryLabel,
} from "../../../../../utils/viewModel";
import styles from "./CategoryFacts.module.scss";

export interface CategoryFactsProps {
  group: AttributedGroupView;
}

/** The why-line of the Reading order and the group's category chips. */
export function CategoryFacts({ group }: CategoryFactsProps) {
  const { t } = useTranslation();
  const dominant = categoryLabel(group.group.dominantCategory);
  const dominantKind = t("brief.focusPanel.dominantKind");
  const secondaryKind = t("brief.focusPanel.secondaryKind");

  return (
    <>
      {group.readingOrderWhy ? (
        <p className={styles["why"]}>{group.readingOrderWhy}</p>
      ) : null}
      <div className={styles["chips"]}>
        <span className={styles["chip"]} data-kind="dominant">
          <span className={styles["kind"]}>{dominantKind}</span>{" "}
          <span>{dominant}</span>
        </span>
        {group.group.secondaryCategories.map((category) => {
          const label = categoryLabel(category);

          return (
            <span className={styles["chip"]} key={category}>
              <span className={styles["kind"]}>{secondaryKind}</span>{" "}
              <span>{label}</span>
            </span>
          );
        })}
        {group.group.uncertain ? (
          <span className={styles["chip"]} data-kind="uncertain">
            {t("brief.focusPanel.uncertain")}
          </span>
        ) : null}
      </div>
    </>
  );
}
