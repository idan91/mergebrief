import type {
  DropdownMultipleSelection,
  DropdownSelection,
  DropdownSingleSelection,
} from "./types";

/** Whether the item holding `value` is ticked under this selection. */
export function isValueSelected(
  selection: DropdownSelection,
  value: string,
): boolean {
  if (selection.multiple) {
    return selection.value.includes(value);
  }
  return selection.value === value;
}

/** Report a choice: replace the one value, or toggle it in the many. */
export function chooseValue(selection: DropdownSelection, value: string): void {
  if (!selection.multiple) {
    selection.onValueChange(value);
    return;
  }
  const next = selection.value.includes(value)
    ? selection.value.filter((chosen) => chosen !== value)
    : [...selection.value, value];
  selection.onValueChange(next);
}

/** The selection a root's props describe, narrowed once for the rows. */
export function readSelection(
  props: DropdownSingleSelection | DropdownMultipleSelection,
): DropdownSelection {
  if (props.multiple) {
    return {
      multiple: true,
      value: props.value,
      onValueChange: props.onValueChange,
    };
  }
  return {
    multiple: false,
    value: props.value,
    onValueChange: props.onValueChange,
  };
}
