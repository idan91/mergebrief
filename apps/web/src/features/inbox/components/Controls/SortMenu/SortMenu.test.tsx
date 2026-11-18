// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FilterView } from "../types";
import { SortMenu } from ".";

afterEach(cleanup);

function makeSort(overrides: Partial<FilterView> = {}): FilterView {
  return {
    id: "sort",
    name: "Sort by",
    options: [
      { value: "updated", label: "Updated" },
      { value: "created", label: "Created" },
    ],
    chosen: ["updated"],
    multiple: false,
    changed: false,
    alwaysNamed: true,
    onChoose: vi.fn(),
    ...overrides,
  };
}

function makeDirection(overrides: Partial<FilterView> = {}): FilterView {
  return {
    id: "direction",
    name: "Order",
    options: [
      { value: "desc", label: "Newest first" },
      { value: "asc", label: "Oldest first" },
    ],
    chosen: ["desc"],
    multiple: false,
    changed: false,
    onChoose: vi.fn(),
    ...overrides,
  };
}

async function openMenu(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Sort/ }));
  });
}

describe("SortMenu", () => {
  it("names the sort alone while it runs newest first", () => {
    render(<SortMenu direction={makeDirection()} sort={makeSort()} />);

    const trigger = screen.getByRole("button", { name: "Sort Updated" });

    expect(trigger.getAttribute("data-state")).toBe("default");
  });

  it("names the direction too once it runs oldest first", () => {
    const direction = makeDirection({ chosen: ["asc"], changed: true });
    const sort = makeSort({ chosen: ["created"], changed: true });
    render(<SortMenu direction={direction} sort={sort} />);

    const trigger = screen.getByRole("button", {
      name: "Sort Created, oldest first",
    });

    expect(trigger.getAttribute("data-state")).toBe("changed");
  });

  it("takes the accent when only the direction is off its default", () => {
    const direction = makeDirection({ chosen: ["asc"], changed: true });
    render(<SortMenu direction={direction} sort={makeSort()} />);

    const trigger = screen.getByRole("button", { name: /^Sort/ });

    expect(trigger.getAttribute("data-state")).toBe("changed");
  });

  it("lists the sorts and the directions as two named groups", async () => {
    render(<SortMenu direction={makeDirection()} sort={makeSort()} />);
    await openMenu();

    expect(screen.getAllByRole("group")).toHaveLength(2);
    expect(screen.getByRole("group", { name: "Sort by" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Order" })).toBeTruthy();
  });

  it("routes a choice to the sort or the direction it belongs to", async () => {
    const sort = makeSort();
    const direction = makeDirection();
    render(<SortMenu direction={direction} sort={sort} />);
    await openMenu();

    fireEvent.click(screen.getByRole("option", { name: "Oldest first" }));
    fireEvent.click(screen.getByRole("option", { name: "Created" }));

    expect(direction.onChoose).toHaveBeenCalledWith("asc");
    expect(sort.onChoose).toHaveBeenCalledWith("created");
  });

  it("stays open after a choice so the direction can follow the sort", async () => {
    render(<SortMenu direction={makeDirection()} sort={makeSort()} />);
    await openMenu();

    fireEvent.click(screen.getByRole("option", { name: "Created" }));

    expect(screen.getByRole("listbox")).toBeTruthy();
  });
});
