// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Button } from "@web/components/Button";
import { Dropdown } from "@web/components/Dropdown";
import type { FilterView } from "../types";
import { deriveFilterSelection } from "../utils";
import { FilterRows } from ".";

afterEach(cleanup);

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener: vi.fn() })),
  );
});

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

async function renderRows(filter: FilterView) {
  const view = render(
    <Dropdown {...deriveFilterSelection(filter)}>
      <Dropdown.Trigger>
        <Button variant="secondary">Open</Button>
      </Dropdown.Trigger>
      <Dropdown.Content label="Review">
        <FilterRows filter={filter} />
      </Dropdown.Content>
    </Dropdown>,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
  });
  return view;
}

describe("FilterRows", () => {
  it("leads with the All row, ticked at All, and reports its choice", async () => {
    const all = {
      label: "All review states",
      triggerLabel: "All",
      checked: true,
      onChoose: vi.fn(),
    };
    await renderRows(makeFilter({ all }));

    const rows = screen.getAllByRole("option");
    expect(rows.map((row) => row.textContent)).toEqual([
      "All review states",
      "New",
      "Reviewed",
    ]);
    expect(rows[0]?.getAttribute("aria-selected")).toBe("true");
    expect(rows[0]?.getAttribute("aria-disabled")).toBeNull();

    await act(async () => {
      fireEvent.click(rows[0]!);
    });
    expect(all.onChoose).toHaveBeenCalledOnce();
  });

  it("gives the All row a glyph box only beside marked rows", async () => {
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

    const plain = await renderRows(makeFilter({ all }));
    const plainRows = screen.getAllByRole("option");
    expect(countSpans(plainRows[0])).toBe(countSpans(plainRows[1]));
    plain.unmount();

    await renderRows(makeFilter({ all, glyphs }));
    const rows = screen.getAllByRole("option");
    expect(countSpans(rows[0])).toBe(countSpans(rows[1]) + 1);
  });
});
