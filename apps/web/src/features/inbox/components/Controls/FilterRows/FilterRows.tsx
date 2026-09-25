import { Dropdown } from "@web/components/Dropdown/Dropdown";
import { FILTER_ALL_VALUE } from "../consts";
import type { FilterView } from "../types";
import { scopeFilterValue } from "../utils";

export interface FilterRowsProps {
  filter: FilterView;
  /** Inside the collapsed listbox each value carries its filter's id. */
  scoped?: boolean;
}

/** A filter's rows: its All row first when it has one, then one row per option. */
export function FilterRows({ filter, scoped = false }: FilterRowsProps) {
  // An empty glyph box keeps the label in line with the marked rows below it.
  const allGlyph = filter.glyphs === undefined ? undefined : <span />;
  const scopeRowValue = (value: string) =>
    scoped ? scopeFilterValue(filter.id, value) : value;

  return (
    <>
      {filter.all === undefined ? null : (
        <Dropdown.Item glyph={allGlyph} value={scopeRowValue(FILTER_ALL_VALUE)}>
          {filter.all.label}
        </Dropdown.Item>
      )}
      {filter.options.map((option) => (
        <Dropdown.Item
          glyph={filter.glyphs?.[option.value]}
          key={option.value}
          value={scopeRowValue(option.value)}
        >
          {option.label}
        </Dropdown.Item>
      ))}
    </>
  );
}
