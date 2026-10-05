import { useTranslation } from "react-i18next";

import type { Category } from "../../../../types";
import {
  getCategoryLabel,
  type AttributedGroupView,
} from "../../../../utils/viewModel";
import styles from "./CategoryFacts.module.scss";

export interface CategoryFactsProps {
  group: AttributedGroupView;
  dominant: Category;
  isReclassified: boolean;
}

/** The why-line of the Reading order and the group's category chips. */
export function CategoryFacts({
  group,
  dominant,
  isReclassified,
}: CategoryFactsProps) {
  const { t } = useTranslation();
  const dominantKind = t("brief.group.dominantKind");
  const secondaryKind = t("brief.group.secondaryKind");
  const dominantLabel = getCategoryLabel(t, dominant);
  const showUncertain = group.group.uncertain && !isReclassified;

  return (
    <>
      {group.readingOrderWhy ? (
        <p className={styles["why"]}>{group.readingOrderWhy}</p>
      ) : null}
      <div className={styles["chips"]}>
        <span className={styles["chip"]} data-kind="dominant">
          <span className={styles["kind"]}>{dominantKind}</span>{" "}
          <span>{dominantLabel}</span>
        </span>
        {group.group.secondaryCategories.map((category) => {
          const label = getCategoryLabel(t, category);

          return (
            <span className={styles["chip"]} key={category}>
              <span className={styles["kind"]}>{secondaryKind}</span>{" "}
              <span>{label}</span>
            </span>
          );
        })}
        {showUncertain ? (
          <span className={styles["chip"]} data-kind="uncertain">
            {t("brief.group.uncertain")}
          </span>
        ) : null}
        {isReclassified ? (
          <span className={styles["note"]}>{t("brief.group.reclassNote")}</span>
        ) : null}
      </div>
    </>
  );
}
