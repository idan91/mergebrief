// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FilterView } from "../types";
import { Filter } from ".";

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener: vi.fn() })),
  );
});

/** The All row plus the three options `makeFilter` lists. */
const ROW_COUNT = 4;

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

  it("lists options, ticks the chosen ones and reports a toggle", async () => {
    const onChoose = vi.fn();
    render(<Filter filter={makeFilter({ chosen: ["new"], onChoose })} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review" }));
    });
    const list = screen.getByRole("listbox", { name: "Review" });
    expect(list.getAttribute("aria-multiselectable")).toBe("true");
    const rows = screen.getAllByRole("option");
    expect(rows.map((row) => row.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
    ]);

    await act(async () => {
      fireEvent.click(rows[2]!);
    });
    expect(onChoose).toHaveBeenCalledWith("reviewed");
    await act(async () => {
      fireEvent.click(rows[0]!);
    });
    expect(onChoose).toHaveBeenCalledWith("new");
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("an All row leads the list and stays open on a choice", async () => {
    const onChooseAll = vi.fn();
    const all = {
      label: "All review states",
      triggerLabel: "All",
      checked: false,
      onChoose: onChooseAll,
    };
    render(<Filter filter={makeFilter({ chosen: ["new"], all })} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review" }));
    });
    const rows = screen.getAllByRole("option");
    expect(rows.map((row) => row.textContent)).toEqual([
      "All review states",
      "New",
      "Updated since your review",
      "Reviewed",
    ]);

    await act(async () => {
      fireEvent.click(rows[0]!);
    });
    expect(onChooseAll).toHaveBeenCalledOnce();
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("the arrow keys reach a ticked All row", async () => {
    const all = {
      label: "All review states",
      triggerLabel: "All",
      checked: true,
      onChoose: vi.fn(),
    };
    render(<Filter filter={makeFilter({ all })} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review" }));
    });
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("role")).toBe("option"),
    );
    const reached: string[] = [];
    for (let press = 0; press < ROW_COUNT; press += 1) {
      await act(async () => {
        fireEvent.keyDown(document.activeElement ?? document.body, {
          key: "ArrowDown",
        });
      });
      reached.push(document.activeElement?.textContent ?? "");
    }

    expect(reached).toContain("All review states");
  });

  it("a ticked All row names the trigger All rather than a count", () => {
    const all = {
      label: "All review states",
      triggerLabel: "All",
      checked: true,
      onChoose: vi.fn(),
    };
    render(
      <Filter
        filter={makeFilter({
          chosen: ["new", "updated", "reviewed"],
          changed: true,
          all,
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Review All" })).toBeTruthy();
  });

  it("a single-choice filter ticks one option and closes on a choice", async () => {
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
    const list = screen.getByRole("listbox", { name: "Sort" });
    expect(list.getAttribute("aria-multiselectable")).toBeNull();
    const rows = screen.getAllByRole("option");
    expect(rows.map((row) => row.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    await act(async () => {
      fireEvent.click(rows[1]!);
    });

    expect(onChoose).toHaveBeenCalledWith("updated");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("the panel opens from its start corner by default", async () => {
    render(<Filter filter={makeFilter()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review" }));
    });

    expect(screen.getByRole("listbox").style.transformOrigin).toBe("top left");
  });
});
