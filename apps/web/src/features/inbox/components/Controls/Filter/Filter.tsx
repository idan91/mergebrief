import { useTranslation } from "react-i18next";

import {
  Dropdown,
  type DropdownProps,
} from "@web/components/Dropdown/Dropdown";
import { Icon } from "@web/components/Icon/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { NAMED_UP_TO } from "../consts";
import { FilterRows } from "../FilterRows/FilterRows";
import styles from "../trigger.module.scss";
import { FilterStates, type FilterState, type FilterView } from "../types";
import { deriveFilterSelection, describeFilterValue } from "../utils";

export interface FilterProps {
  filter: FilterView;
  placement?: DropdownProps["placement"];
}

/**
 * A 28px bordered control naming one filter. It shows its name only; a
 * value appears when set, several values as a count. A changed filter takes
 * the accent tint and an accent value. Its listbox lists the options, chosen
 * ones ticked, a review mark beside each review state.
 */
export function Filter({ filter, placement = "bottom-start" }: FilterProps) {
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
  const selection = deriveFilterSelection(filter);

  return (
    <Dropdown placement={placement} {...selection}>
      <Dropdown.Trigger>
        {/* oxlint-disable-next-line house/no-raw-button -- the filter names itself by its content; no shared primitive has that shape */}
        <button
          aria-label={triggerLabel}
          className={styles["filter"]}
          data-state={state}
          type="button"
        >
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
        </button>
      </Dropdown.Trigger>
      <Dropdown.Content label={filter.name}>
        <FilterRows filter={filter} />
      </Dropdown.Content>
    </Dropdown>
  );
}
