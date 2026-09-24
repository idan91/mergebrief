import { useTranslation } from "react-i18next";

import { Menu } from "@web/components/Menu/Menu";
import { MenuTriggerKinds } from "@web/components/Menu/types";
import { Icon } from "@web/components/Icon/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { NAMED_UP_TO } from "../consts";
import { FilterRows } from "../FilterRows/FilterRows";
import styles from "../trigger.module.scss";
import { FilterStates, type FilterState, type FilterView } from "../types";
import { describeFilterValue } from "../utils";

export interface FilterProps {
  filter: FilterView;
}

/**
 * A 28px bordered control naming one filter. It shows its name only; a
 * value appears when set, several values as a count. A changed filter takes
 * the accent tint and an accent value. Its menu lists the options, checked
 * ones marked, a review mark beside each review state.
 */
export function Filter({ filter }: FilterProps) {
  const { t } = useTranslation();
  const value = describeFilterValue(filter);
  const allChecked = filter.all?.checked === true;
  const counting =
    !allChecked && filter.chosen.length > (filter.namedUpTo ?? NAMED_UP_TO);
  const triggerLabel =
    value !== undefined && counting
      ? `${filter.name}, ${t("home.filters.chosen", { count: filter.chosen.length })}`
      : undefined;
  const state: FilterState = filter.changed
    ? FilterStates.CHANGED
    : FilterStates.DEFAULT;

  return (
    <Menu
      label={filter.name}
      placement="bottom-start"
      trigger={
        <>
          <span className={styles["name"]}>{filter.name}</span>
          {value === undefined ? null : (
            <>
              {" "}
              <span className={styles["value"]}>{value}</span>
            </>
          )}
          <Icon
            className={styles["caret"]}
            name={IconNames.CARET_DOWN}
            size={IconSizes.SM}
          />
        </>
      }
      triggerClassName={styles["filter"]}
      triggerKind={MenuTriggerKinds.TEXT}
      triggerLabel={triggerLabel}
      triggerState={state}
    >
      <FilterRows filter={filter} />
    </Menu>
  );
}
