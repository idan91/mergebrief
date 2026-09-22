// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FilterView } from "../types";
import { Filter } from "./Filter";

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
      { value: "updated", label: "Updated since your review" },
      { value: "reviewed", label: "Reviewed" },
    ],
    chosen: [],
    multiple: true,
    changed: false,
    onChoose: vi.fn(),
    ...overrides,
  };
}

describe("Filter", () => {
  it("shows its name only until a value is set", () => {
    render(<Filter filter={makeFilter()} />);

    const trigger = screen.getByRole("button", { name: "Review" });
    expect(trigger.getAttribute("data-state")).toBe("default");
  });

  it("a changed filter shows its value, or a count past the limit", () => {
    const { unmount } = render(
      <Filter filter={makeFilter({ chosen: ["new"], changed: true })} />,
    );
    expect(screen.getByRole("button", { name: "Review New" })).toBeTruthy();
    unmount();

    render(
      <Filter
        filter={makeFilter({ chosen: ["new", "reviewed"], changed: true })}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Review, 2 chosen" });
    expect(trigger.getAttribute("data-state")).toBe("changed");
  });

  it("lists checkbox rows, marks the chosen ones and reports a choice", async () => {
    const onChoose = vi.fn();
    render(<Filter filter={makeFilter({ chosen: ["new"], onChoose })} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review" }));
    });
    const rows = screen.getAllByRole("menuitemcheckbox");
    expect(rows.map((row) => row.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
    ]);

    await act(async () => {
      fireEvent.click(rows[2]!);
    });
    expect(onChoose).toHaveBeenCalledWith("reviewed");
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("a single-choice filter lists radio rows and closes on a choice", async () => {
    const onChoose = vi.fn();
    render(
      <Filter
        filter={makeFilter({
          id: "sort",
          name: "Sort",
          multiple: false,
          chosen: ["new"],
          onChoose,
        })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    });
    const rows = screen.getAllByRole("menuitemradio");
    await act(async () => {
      fireEvent.click(rows[1]!);
    });

    expect(onChoose).toHaveBeenCalledWith("updated");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
