import { useTranslation } from "react-i18next";

import { Menu } from "@web/components/Menu/Menu";
import { MenuTriggerKinds } from "@web/components/Menu/types";
import { Icon } from "@web/components/Icon/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { FilterRows } from "../FilterRows/FilterRows";
import filterStyles from "../trigger.module.scss";
import { FilterStates, type FilterState, type FilterView } from "../types";
import styles from "./CollapsedFilters.module.scss";

export interface CollapsedFiltersProps {
  filters: readonly FilterView[];
  changedCount: number;
}

/** Under 760px every filter sits in one menu, grouped under its name. */
export function CollapsedFilters({
  filters,
  changedCount,
}: CollapsedFiltersProps) {
  const { t } = useTranslation();
  const state: FilterState =
    changedCount > 0 ? FilterStates.CHANGED : FilterStates.DEFAULT;

  return (
    <Menu
      label={t("home.filters.filters")}
      placement="bottom-start"
      trigger={
        <>
          <Icon
            className={filterStyles["caret"]}
            name={IconNames.SLIDERS_HORIZONTAL}
            size={IconSizes.MD}
          />
          <span className={filterStyles["name"]}>
            {t("home.filters.filters")}
          </span>
          {changedCount === 0 ? null : (
            <>
              {" "}
              <span className={filterStyles["value"]}>
                {t("home.filters.changed", { count: changedCount })}
              </span>
            </>
          )}
        </>
      }
      triggerClassName={filterStyles["filter"]}
      triggerKind={MenuTriggerKinds.TEXT}
      triggerState={state}
    >
      {filters.map((filter) => (
        <div
          aria-labelledby={`inbox-filter-${filter.id}`}
          className={styles["group"]}
          key={filter.id}
          role="group"
        >
          <span
            className={styles["groupLabel"]}
            id={`inbox-filter-${filter.id}`}
          >
            {filter.name}
          </span>
          <FilterRows filter={filter} />
        </div>
      ))}
    </Menu>
  );
}
