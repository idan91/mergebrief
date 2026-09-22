import { useTranslation } from "react-i18next";

import { Menu, MenuTriggerKinds } from "@web/components/Menu/Menu";
import { MenuRow } from "@web/components/Menu/MenuRow/MenuRow";
import SlidersIcon from "../../icons/sliders.svg?react";
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
          <SlidersIcon aria-hidden="true" className={filterStyles["caret"]} />
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
          {filter.options.map((option) => (
            <MenuRow
              checked={filter.chosen.includes(option.value)}
              glyph={filter.glyphs?.[option.value]}
              key={option.value}
              multiple={filter.multiple}
              onSelect={() => filter.onChoose(option.value)}
            >
              {option.label}
            </MenuRow>
          ))}
        </div>
      ))}
    </Menu>
  );
}
