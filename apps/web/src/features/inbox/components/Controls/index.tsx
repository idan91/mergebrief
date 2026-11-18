import type { RefObject } from "react";
import { useTranslation } from "react-i18next";

import { LinkButton } from "@web/components/LinkButton";
import type { SearchTextOverride } from "../../types";
import { CollapsedFilters } from "./CollapsedFilters";
import styles from "./Controls.module.scss";
import { Filter } from "./Filter";
import { MoreFilters } from "./MoreFilters";
import { SearchField } from "./SearchField";
import type { FilterView } from "./types";
import { useNarrowViewport } from "./useNarrowViewport";

export interface ControlsProps {
  filters: readonly FilterView[];
  sort: FilterView;
  /** Folded or mixed; the control is named View. */
  layout: FilterView;
  changedCount: number;
  /** The search text the URL holds; empty when the reviewer is not searching. */
  searchText: string;
  /** Rows the list holds for the current filters and search text. */
  total: number;
  /** The text a Clear, a Back or a link put in place, for the search field. */
  searchTextOverride: SearchTextOverride;
  onSearch: (text: string) => void;
  /** The reviewer typed past a search whose list is still loading. */
  onDropPendingSearch: () => void;
  /** The search input, for a caller that hands focus to it. */
  searchFieldRef?: RefObject<HTMLInputElement | null>;
  onClear: () => void;
}

/**
 * The row above the list: the search field, the common filters and More
 * filters, then Clear beside View and Sort. Under 760px the search field takes
 * its own line and every filter collapses behind one button below it.
 */
export function Controls({
  filters,
  sort,
  layout,
  changedCount,
  searchText,
  total,
  searchTextOverride,
  onSearch,
  onDropPendingSearch,
  searchFieldRef,
  onClear,
}: ControlsProps) {
  const { t } = useTranslation();
  const narrow = useNarrowViewport();
  const shownFilters = filters.filter((filter) => filter.underMore !== true);
  const moreFilters = filters.filter((filter) => filter.underMore === true);
  // The search field sits outside the collapsed sheet, so its text is not the sheet's to count.
  const collapsedCount = searchText === "" ? changedCount : changedCount - 1;

  return (
    <div
      aria-label={t("home.filters.ariaLabelControls")}
      className={styles["controls"]}
      role="group"
    >
      <div className={styles["search"]}>
        <SearchField
          fieldRef={searchFieldRef}
          override={searchTextOverride}
          resultCount={total}
          value={searchText}
          onDropPendingSearch={onDropPendingSearch}
          onSearch={onSearch}
        />
      </div>
      <div className={styles["filters"]}>
        {narrow ? (
          <CollapsedFilters changedCount={collapsedCount} filters={filters} />
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
