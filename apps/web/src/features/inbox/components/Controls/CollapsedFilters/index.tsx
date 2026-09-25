import { useTranslation } from "react-i18next";

import { Dropdown } from "@web/components/Dropdown";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { FilterRows } from "../FilterRows";
import filterStyles from "../trigger.module.scss";
import { FilterStates, type FilterState, type FilterView } from "../types";
import { deriveCollapsedSelection } from "../utils";

export interface CollapsedFiltersProps {
  filters: readonly FilterView[];
  changedCount: number;
}

/** Under 760px every filter sits in one listbox, grouped under its name; it stays open across choices. */
export function CollapsedFilters({
  filters,
  changedCount,
}: CollapsedFiltersProps) {
  const { t } = useTranslation();
  const state: FilterState =
    changedCount > 0 ? FilterStates.CHANGED : FilterStates.DEFAULT;
  const selection = deriveCollapsedSelection(filters);
  const label = t("home.filters.filters");

  return (
    <Dropdown {...selection}>
      <Dropdown.Trigger>
        {/* oxlint-disable-next-line house/no-raw-button -- the filter names itself by its content; no shared primitive has that shape */}
        <button
          className={filterStyles["filter"]}
          data-state={state}
          type="button"
        >
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
        </button>
      </Dropdown.Trigger>
      <Dropdown.Content label={label}>
        {filters.map((filter) => (
          <Dropdown.Group key={filter.id} label={filter.name}>
            <FilterRows filter={filter} scoped />
          </Dropdown.Group>
        ))}
      </Dropdown.Content>
    </Dropdown>
  );
}
