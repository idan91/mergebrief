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
import { CollapsedFilters } from "./CollapsedFilters";

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

    const groups = screen.getAllByRole("group");
    expect(
      groups.map((group) => group.getAttribute("aria-labelledby")),
    ).toEqual(["inbox-filter-review", "inbox-filter-author"]);
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "New" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "All review states" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(2);
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
