import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { GroupedFilters } from "../GroupedFilters";
import filterStyles from "../trigger.module.scss";
import { FilterStates, type FilterState, type FilterView } from "../types";
import { describeFilterValue } from "../utils";

export interface SortMenuProps {
  sort: FilterView;
  direction: FilterView;
}

/**
 * The sort and the way it runs in one listbox, a group each, open across
 * choices so the direction can follow the sort. The trigger names the sort,
 * and the direction only once it runs oldest first.
 */
export function SortMenu({ sort, direction }: SortMenuProps) {
  const { t } = useTranslation();
  const label = t("home.filters.sort");
  const sortLabel = describeFilterValue(sort) ?? "";
  const value = direction.changed
    ? t("home.filters.sortValueOldestFirst", { sort: sortLabel })
    : sortLabel;
  const changed = sort.changed || direction.changed;
  const state: FilterState = changed
    ? FilterStates.CHANGED
    : FilterStates.DEFAULT;
  const groups = [sort, direction];

  return (
    <GroupedFilters
      filters={groups}
      label={label}
      placement="bottom-end"
      state={state}
    >
      <span className={filterStyles["name"]}>{label}</span>{" "}
      <span className={filterStyles["value"]}>{value}</span>
      <Icon
        className={filterStyles["caret"]}
        name={IconNames.CARET_DOWN}
        size={IconSizes.SM}
      />
    </GroupedFilters>
  );
}
