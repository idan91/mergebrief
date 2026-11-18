import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { GroupedFilters } from "../GroupedFilters";
import filterStyles from "../trigger.module.scss";
import { FilterStates, type FilterState, type FilterView } from "../types";

export interface MoreFiltersProps {
  filters: readonly FilterView[];
}

/**
 * The filters most sessions never touch, grouped under their names in one
 * listbox that stays open across choices. The trigger counts those in use.
 */
export function MoreFilters({ filters }: MoreFiltersProps) {
  const { t } = useTranslation();
  const usedCount = filters.filter((filter) => filter.changed).length;
  const state: FilterState =
    usedCount > 0 ? FilterStates.CHANGED : FilterStates.DEFAULT;
  const label = t("home.inbox.filters.more");
  const triggerLabel =
    usedCount > 0
      ? t("home.inbox.filters.moreCount", { count: usedCount })
      : label;

  return (
    <GroupedFilters filters={filters} label={label} state={state}>
      <span className={filterStyles["name"]}>{triggerLabel}</span>
      <Icon
        className={filterStyles["caret"]}
        name={IconNames.CARET_DOWN}
        size={IconSizes.SM}
      />
    </GroupedFilters>
  );
}
