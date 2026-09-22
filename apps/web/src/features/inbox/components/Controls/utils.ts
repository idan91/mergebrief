import { NAMED_UP_TO } from "./consts";
import type { FilterView } from "./types";

/** The label a filter prints beside its name: none, the choice, or how many. */
export function describeFilterValue(filter: FilterView): string | undefined {
  if (!filter.changed && filter.alwaysNamed !== true) return undefined;
  const labels = filter.chosen.map(
    (value) =>
      filter.options.find((option) => option.value === value)?.label ?? value,
  );
  const namedUpTo = filter.namedUpTo ?? NAMED_UP_TO;
  if (labels.length > namedUpTo) return String(labels.length);
  return labels.join(", ");
}
