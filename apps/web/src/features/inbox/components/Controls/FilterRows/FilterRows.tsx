import { MenuRow } from "@web/components/Menu/MenuRow/MenuRow";
import type { FilterView } from "../types";

export interface FilterRowsProps {
  filter: FilterView;
}

/** A filter's rows: its All row first when it has one, then one row per option. */
export function FilterRows({ filter }: FilterRowsProps) {
  // An empty glyph box keeps the label in line with the marked rows below it.
  const allGlyph = filter.glyphs === undefined ? undefined : <span />;

  return (
    <>
      {filter.all === undefined ? null : (
        <MenuRow
          checked={filter.all.checked}
          glyph={allGlyph}
          multiple
          onSelect={filter.all.onChoose}
        >
          {filter.all.label}
        </MenuRow>
      )}
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
    </>
  );
}
