import type {
  DropdownMultipleSelection,
  DropdownSelection,
} from "@web/components/Dropdown/types";
import {
  COLLAPSED_VALUE_SEPARATOR,
  FILTER_ALL_VALUE,
  NAMED_UP_TO,
} from "./consts";
import type { FilterAllRow, FilterView } from "./types";

/** The label a filter prints beside its name: none, the choice, or how many. */
export function describeFilterValue(filter: FilterView): string | undefined {
  if (!filter.changed && filter.alwaysNamed !== true) {
    return undefined;
  }
  if (filter.all?.checked === true) {
    return filter.all.triggerLabel;
  }
  const labels = filter.chosen.map(
    (value) =>
      filter.options.find((option) => option.value === value)?.label ?? value,
  );
  const namedUpTo = filter.namedUpTo ?? NAMED_UP_TO;
  if (labels.length > namedUpTo) {
    return String(labels.length);
  }
  return labels.join(", ");
}

/** An All row: choosing it while it is ticked changes nothing, not even the page. */
export function buildAllRow(
  labels: { readonly label: string; readonly triggerLabel: string },
  checked: boolean,
  choose: () => void,
): FilterAllRow {
  return {
    label: labels.label,
    triggerLabel: labels.triggerLabel,
    checked,
    onChoose: () => {
      if (!checked) {
        choose();
      }
    },
  };
}

/** The one value present in exactly one of the two lists; none when they match. */
export function findToggledValue(
  current: readonly string[],
  next: readonly string[],
): string | undefined {
  const added = next.find((value) => !current.includes(value));
  if (added !== undefined) {
    return added;
  }
  return current.find((value) => !next.includes(value));
}

/** The values a filter's listbox shows ticked: its choices, plus the All row while it is ticked. */
export function listTickedValues(filter: FilterView): string[] {
  const ticked = [...filter.chosen];
  if (filter.all?.checked === true) {
    ticked.push(FILTER_ALL_VALUE);
  }
  return ticked;
}

/** Route one toggled listbox value to the filter's own handlers. */
function chooseFilterValue(filter: FilterView, value: string): void {
  if (value === FILTER_ALL_VALUE) {
    filter.all?.onChoose();
    return;
  }
  filter.onChoose(value);
}

/** The selection a filter's own listbox runs on: many that toggle, or one that replaces. */
export function deriveFilterSelection(filter: FilterView): DropdownSelection {
  if (!filter.multiple) {
    const allTicked = filter.all?.checked === true;
    return {
      multiple: false,
      value: allTicked ? FILTER_ALL_VALUE : filter.chosen[0],
      onValueChange: (value) => chooseFilterValue(filter, value),
    };
  }
  const ticked = listTickedValues(filter);
  return {
    multiple: true,
    value: ticked,
    onValueChange: (next) => {
      const toggled = findToggledValue(ticked, next);
      if (toggled !== undefined) {
        chooseFilterValue(filter, toggled);
      }
    },
  };
}

/** A filter's value as the collapsed listbox names it, unique across filters. */
export function scopeFilterValue(filterId: string, value: string): string {
  return `${filterId}${COLLAPSED_VALUE_SEPARATOR}${value}`;
}

/**
 * The selection every filter shares in the collapsed listbox: one multiple
 * list whose values carry their filter's id, routed back to that filter.
 */
export function deriveCollapsedSelection(
  filters: readonly FilterView[],
): DropdownMultipleSelection {
  const ticked = filters.flatMap((filter) =>
    listTickedValues(filter).map((value) => scopeFilterValue(filter.id, value)),
  );
  return {
    multiple: true,
    value: ticked,
    onValueChange: (next) => {
      const toggled = findToggledValue(ticked, next);
      if (toggled === undefined) {
        return;
      }
      const separatorAt = toggled.indexOf(COLLAPSED_VALUE_SEPARATOR);
      const filterId = toggled.slice(0, separatorAt);
      const value = toggled.slice(separatorAt + 1);
      const filter = filters.find((candidate) => candidate.id === filterId);
      if (filter !== undefined) {
        chooseFilterValue(filter, value);
      }
    },
  };
}
