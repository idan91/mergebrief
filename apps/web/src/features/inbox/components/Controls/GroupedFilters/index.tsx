import type { ReactNode } from "react";

import { Dropdown } from "@web/components/Dropdown";
import { FilterRows } from "../FilterRows";
import filterStyles from "../trigger.module.scss";
import type { FilterState, FilterView } from "../types";
import { deriveCollapsedSelection } from "../utils";

export interface GroupedFiltersProps {
  filters: readonly FilterView[];
  /** The listbox's accessible name. */
  label: string;
  state: FilterState;
  sheet?: boolean;
  /** What the trigger shows. */
  children: ReactNode;
}

/** The given filters in one listbox, grouped under their names; it stays open across choices. */
export function GroupedFilters({
  filters,
  label,
  state,
  sheet,
  children,
}: GroupedFiltersProps) {
  const selection = deriveCollapsedSelection(filters);

  return (
    <Dropdown
      multiple
      value={selection.value}
      onValueChange={selection.onValueChange}
    >
      <Dropdown.Trigger>
        {/* oxlint-disable-next-line house/no-raw-button -- the filter names itself by its content; no shared primitive has that shape */}
        <button
          className={filterStyles["filter"]}
          data-state={state}
          type="button"
        >
          {children}
        </button>
      </Dropdown.Trigger>
      <Dropdown.Content label={label} sheet={sheet}>
        {filters.map((filter) => (
          <Dropdown.Group key={filter.id} label={filter.name}>
            <FilterRows filter={filter} scoped />
          </Dropdown.Group>
        ))}
      </Dropdown.Content>
    </Dropdown>
  );
}
