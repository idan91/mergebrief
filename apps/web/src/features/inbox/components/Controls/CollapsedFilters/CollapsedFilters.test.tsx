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
import { CollapsedFilters } from ".";

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
      { value: "updated", label: "Updated" },
    ],
    chosen: ["new"],
    multiple: true,
    changed: true,
    onChoose: vi.fn(),
    ...overrides,
  };
}

describe("CollapsedFilters", () => {
  it("names the changed count on its trigger and groups every filter", async () => {
    render(
      <CollapsedFilters
        changedCount={2}
        filters={[
          makeFilter({
            all: {
              label: "All review states",
              triggerLabel: "All",
              checked: false,
              onChoose: vi.fn(),
            },
          }),
          makeFilter({ id: "author", name: "Author", multiple: false }),
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Filters 2 changed" });
    expect(trigger.getAttribute("data-state")).toBe("changed");

    await act(async () => {
      fireEvent.click(trigger);
    });

    const list = screen.getByRole("listbox", { name: "Filters" });
    expect(list.getAttribute("aria-multiselectable")).toBe("true");
    const groups = screen.getAllByRole("group");
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      null,
      null,
    ]);
    expect(screen.getByRole("group", { name: "Review" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Author" })).toBeTruthy();
    const review = screen.getByRole("group", { name: "Review" });
    expect(
      review.querySelector('[role=option][aria-selected="true"]')?.textContent,
    ).toBe("New");
    expect(
      screen
        .getByRole("option", { name: "All review states" })
        .getAttribute("aria-selected"),
    ).toBe("false");
    expect(
      screen
        .getByRole("group", { name: "Author" })
        .querySelectorAll("[role=option]"),
    ).toHaveLength(2);
  });

  it("routes a choice to its own filter and stays open", async () => {
    const onChooseReview = vi.fn();
    const onChooseAuthor = vi.fn();
    render(
      <CollapsedFilters
        changedCount={0}
        filters={[
          makeFilter({ onChoose: onChooseReview }),
          makeFilter({
            id: "author",
            name: "Author",
            multiple: false,
            chosen: ["new"],
            onChoose: onChooseAuthor,
          }),
        ]}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    });
    const author = screen.getByRole("group", { name: "Author" });
    const updated = author.querySelectorAll("[role=option]")[1];

    await act(async () => {
      fireEvent.click(updated!);
    });

    expect(onChooseAuthor).toHaveBeenCalledWith("updated");
    expect(onChooseReview).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("at the default it says Filters alone", () => {
    render(<CollapsedFilters changedCount={0} filters={[makeFilter()]} />);

    expect(
      screen
        .getByRole("button", { name: "Filters" })
        .getAttribute("data-state"),
    ).toBe("default");
  });
});
