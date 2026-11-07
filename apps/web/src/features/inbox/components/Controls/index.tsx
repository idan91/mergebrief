import { useTranslation } from "react-i18next";

import { LinkButton } from "@web/components/LinkButton";
import { CollapsedFilters } from "./CollapsedFilters";
import styles from "./Controls.module.scss";
import { Filter } from "./Filter";
import { MoreFilters } from "./MoreFilters";
import type { FilterView } from "./types";
import { useNarrowViewport } from "./useNarrowViewport";

export interface ControlsProps {
  filters: readonly FilterView[];
  sort: FilterView;
  /** Folded or mixed; the control is named View. */
  layout: FilterView;
  changedCount: number;
  onClear: () => void;
}

/**
 * The row above the list: the common filters and More filters, then Clear beside
 * View and Sort. Under 760px every filter collapses behind one button and the row
 * takes the full width.
 */
export function Controls({
  filters,
  sort,
  layout,
  changedCount,
  onClear,
}: ControlsProps) {
  const { t } = useTranslation();
  const narrow = useNarrowViewport();
  const shownFilters = filters.filter((filter) => filter.underMore !== true);
  const moreFilters = filters.filter((filter) => filter.underMore === true);

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
          <>
            {shownFilters.map((filter) => (
              <Filter filter={filter} key={filter.id} />
            ))}
            <MoreFilters filters={moreFilters} />
          </>
        )}
      </div>
      <div className={styles["end"]}>
        {changedCount === 0 ? null : (
          <LinkButton className={styles["clear"]} onClick={onClear}>
            {t("home.filters.clear")}
          </LinkButton>
        )}
        <Filter filter={layout} placement="bottom-end" />
        <Filter filter={sort} placement="bottom-end" />
      </div>
    </div>
  );
}
