import { useTranslation } from "react-i18next";

import { LinkButton } from "@web/components/LinkButton/LinkButton";
import { CollapsedFilters } from "./CollapsedFilters/CollapsedFilters";
import styles from "./Controls.module.scss";
import { Filter } from "./Filter/Filter";
import type { FilterView } from "./types";
import { useNarrowViewport } from "./useNarrowViewport";

export interface ControlsProps {
  filters: readonly FilterView[];
  sort: FilterView;
  changedCount: number;
  onClear: () => void;
}

/**
 * The row above the list: the filters, then Clear beside Sort. Under 760px
 * the filters collapse behind one button and the row takes the full width.
 */
export function Controls({
  filters,
  sort,
  changedCount,
  onClear,
}: ControlsProps) {
  const { t } = useTranslation();
  const narrow = useNarrowViewport();

  return (
    <div
      aria-label={t("home.filters.ariaLabelControls")}
      className={styles["controls"]}
      role="group"
    >
      <div className={styles["filters"]}>
        {narrow ? (
          <CollapsedFilters changedCount={changedCount} filters={filters} />
        ) : (
          filters.map((filter) => <Filter filter={filter} key={filter.id} />)
        )}
      </div>
      <div className={styles["end"]}>
        {changedCount === 0 ? null : (
          <LinkButton className={styles["clear"]} onClick={onClear}>
            {t("home.filters.clear")}
          </LinkButton>
        )}
        <Filter filter={sort} />
      </div>
    </div>
  );
}
