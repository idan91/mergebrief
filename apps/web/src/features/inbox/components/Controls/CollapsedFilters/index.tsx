import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { GroupedFilters } from "../GroupedFilters";
import filterStyles from "../trigger.module.scss";
import { FilterStates, type FilterState, type FilterView } from "../types";

export interface CollapsedFiltersProps {
  filters: readonly FilterView[];
  changedCount: number;
}

/** Under 760px every filter sits in one listbox on a bottom sheet, grouped under its name; it stays open across choices. */
export function CollapsedFilters({
  filters,
  changedCount,
}: CollapsedFiltersProps) {
  const { t } = useTranslation();
  const state: FilterState =
    changedCount > 0 ? FilterStates.CHANGED : FilterStates.DEFAULT;
  const label = t("home.filters.filters");

  return (
    <GroupedFilters filters={filters} label={label} sheet state={state}>
      <Icon
        className={filterStyles["caret"]}
        name={IconNames.SLIDERS_HORIZONTAL}
        size={IconSizes.MD}
      />
      <span className={filterStyles["name"]}>{label}</span>
      {changedCount === 0 ? null : (
        <>
          {" "}
          <span className={filterStyles["value"]}>
            {t("home.filters.changed", { count: changedCount })}
          </span>
        </>
      )}
    </GroupedFilters>
  );
}
