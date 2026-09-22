import { NAMED_UP_TO } from "./consts";
import type { FilterAllRow, FilterView } from "./types";

/** The label a filter prints beside its name: none, the choice, or how many. */
export function describeFilterValue(filter: FilterView): string | undefined {
  if (!filter.changed && filter.alwaysNamed !== true) return undefined;
  if (filter.all?.checked === true) return filter.all.triggerLabel;
  const labels = filter.chosen.map(
    (value) =>
      filter.options.find((option) => option.value === value)?.label ?? value,
  );
  const namedUpTo = filter.namedUpTo ?? NAMED_UP_TO;
  if (labels.length > namedUpTo) return String(labels.length);
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
      if (!checked) choose();
    },
  };
}
