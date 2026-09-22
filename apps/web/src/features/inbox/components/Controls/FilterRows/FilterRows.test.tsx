// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MenuContext,
  type MenuContextValue,
} from "@web/components/Menu/context";
import type { FilterView } from "../types";
import { FilterRows } from "./FilterRows";

afterEach(cleanup);

function makeFilter(overrides: Partial<FilterView> = {}): FilterView {
  return {
    id: "review",
    name: "Review",
    options: [
      { value: "new", label: "New" },
      { value: "reviewed", label: "Reviewed" },
    ],
    chosen: [],
    multiple: true,
    changed: false,
    onChoose: vi.fn(),
    ...overrides,
  };
}

const MENU: MenuContextValue = {
  activeIndex: null,
  close: vi.fn(),
  getItemProps: (props) => ({ ...props }),
};

function renderRows(filter: FilterView) {
  return render(
    <MenuContext.Provider value={MENU}>
      <FilterRows filter={filter} />
    </MenuContext.Provider>,
  );
}

describe("FilterRows", () => {
  it("leads with the All row, ticked at All, and reports its choice", () => {
    const all = {
      label: "All review states",
      triggerLabel: "All",
      checked: true,
      onChoose: vi.fn(),
    };
    renderRows(makeFilter({ all }));

    const rows = screen.getAllByRole("menuitemcheckbox");
    expect(rows.map((row) => row.textContent)).toEqual([
      "All review states",
      "New",
      "Reviewed",
    ]);
    expect(rows[0]?.getAttribute("aria-checked")).toBe("true");
    expect(rows[0]?.getAttribute("aria-disabled")).toBeNull();

    fireEvent.click(rows[0]!);
    expect(all.onChoose).toHaveBeenCalledOnce();
  });

  it("gives the All row a glyph box only beside marked rows", () => {
    const all = {
      label: "All review states",
      triggerLabel: "All",
      checked: false,
      onChoose: vi.fn(),
    };
    const glyphs = { new: <svg />, reviewed: <svg /> };
    function countSpans(row: HTMLElement | undefined): number {
      return row?.querySelectorAll("span").length ?? 0;
    }

    const plain = renderRows(makeFilter({ all }));
    const plainRows = screen.getAllByRole("menuitemcheckbox");
    expect(countSpans(plainRows[0])).toBe(countSpans(plainRows[1]));
    plain.unmount();

    renderRows(makeFilter({ all, glyphs }));
    const rows = screen.getAllByRole("menuitemcheckbox");
    expect(countSpans(rows[0])).toBe(countSpans(rows[1]) + 1);
  });
});
