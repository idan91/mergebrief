// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import { Controls } from ".";
import type { FilterView, HeldViewChoice } from "./types";

afterEach(() => {
  cleanup();
  resetMediaQueries();
});

beforeEach(() => {
  setMediaQueryMatches("(prefers-reduced-motion: reduce)", true);
});

const NO_OVERRIDE = { count: 0, text: "" };
const HELD_VIEW: HeldViewChoice = {
  value: "all",
  count: 2,
  onChoose: vi.fn(),
};

function makeFilter(id: string, name: string): FilterView {
  return {
    id,
    name,
    options: [
      { value: "one", label: "One" },
      { value: "two", label: "Two" },
    ],
    chosen: ["one"],
    multiple: false,
    changed: false,
    onChoose: vi.fn(),
  };
}

async function openPanel(name: string): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
  return screen.getByRole("listbox");
}

describe("Controls", () => {
  it("View and Sort open from their end corner, a filter from its start", async () => {
    render(
      <Controls
        changedCount={0}
        heldView={HELD_VIEW}
        filters={[makeFilter("review", "Review")]}
        layout={makeFilter("layout", "View")}
        direction={makeFilter("direction", "Order")}
        sort={makeFilter("sort", "Sort")}
        searchTextOverride={NO_OVERRIDE}
        searchText=""
        total={0}
        onClear={vi.fn()}
        onDropPendingSearch={vi.fn()}
        onSearch={vi.fn()}
      />,
    );

    expect((await openPanel("Sort")).style.transformOrigin).toBe("top right");
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: "Escape",
      });
    });
    expect((await openPanel("View")).style.transformOrigin).toBe("top right");
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: "Escape",
      });
    });
    expect((await openPanel("Review")).style.transformOrigin).toBe("top left");
  });

  it("keeps the common filters out and folds the rest under More filters", async () => {
    render(
      <Controls
        changedCount={0}
        heldView={HELD_VIEW}
        filters={[
          makeFilter("review", "Review"),
          { ...makeFilter("author", "Author"), underMore: true },
        ]}
        layout={makeFilter("layout", "View")}
        direction={makeFilter("direction", "Order")}
        sort={makeFilter("sort", "Sort")}
        searchTextOverride={NO_OVERRIDE}
        searchText=""
        total={0}
        onClear={vi.fn()}
        onDropPendingSearch={vi.fn()}
        onSearch={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Review" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Author" })).toBeNull();
    const listbox = await openPanel("More filters");
    expect(within(listbox).getByText("Author")).toBeTruthy();
  });

  it("counts the filters in use on More filters", () => {
    render(
      <Controls
        changedCount={1}
        heldView={HELD_VIEW}
        filters={[
          {
            ...makeFilter("author", "Author"),
            changed: true,
            underMore: true,
          },
          { ...makeFilter("list", "List"), underMore: true },
        ]}
        layout={makeFilter("layout", "View")}
        direction={makeFilter("direction", "Order")}
        sort={makeFilter("sort", "Sort")}
        searchTextOverride={NO_OVERRIDE}
        searchText=""
        total={0}
        onClear={vi.fn()}
        onDropPendingSearch={vi.fn()}
        onSearch={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "More filters (1)" }),
    ).toBeTruthy();
  });

  it("search text is not counted on the collapsed Filters button", () => {
    setMediaQueryMatches("(width < 760px)", true);
    render(
      <Controls
        changedCount={2}
        heldView={HELD_VIEW}
        filters={[{ ...makeFilter("review", "Review"), changed: true }]}
        layout={makeFilter("layout", "View")}
        direction={makeFilter("direction", "Order")}
        sort={makeFilter("sort", "Sort")}
        searchTextOverride={NO_OVERRIDE}
        searchText="anchor"
        total={3}
        onClear={vi.fn()}
        onDropPendingSearch={vi.fn()}
        onSearch={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Filters/ }).textContent).toBe(
      "Filters 1 changed",
    );
  });

  it("the Held view is a named radio group with its count, on one tab stop", async () => {
    const onChoose = vi.fn();
    render(
      <Controls
        changedCount={0}
        heldView={{ ...HELD_VIEW, onChoose }}
        filters={[makeFilter("review", "Review")]}
        layout={makeFilter("layout", "View")}
        direction={makeFilter("direction", "Order")}
        sort={makeFilter("sort", "Sort")}
        searchTextOverride={NO_OVERRIDE}
        searchText=""
        total={0}
        onClear={vi.fn()}
        onDropPendingSearch={vi.fn()}
        onSearch={vi.fn()}
      />,
    );

    const group = screen.getByRole("group", { name: "Show" });
    const all = within(group).getByRole("radio", { name: "All" });
    const held = within(group).getByRole("radio", { name: "Held 2" });
    expect((all as HTMLInputElement).checked).toBe(true);
    await act(async () => {
      fireEvent.click(held);
    });
    expect(onChoose).toHaveBeenCalledWith("held");
  });

  it("the Held view stays out of the collapsed count, as search text does", () => {
    setMediaQueryMatches("(width < 760px)", true);
    render(
      <Controls
        changedCount={2}
        heldView={{ ...HELD_VIEW, value: "held" }}
        filters={[{ ...makeFilter("review", "Review"), changed: true }]}
        layout={makeFilter("layout", "View")}
        direction={makeFilter("direction", "Order")}
        sort={makeFilter("sort", "Sort")}
        searchTextOverride={NO_OVERRIDE}
        searchText=""
        total={3}
        onClear={vi.fn()}
        onDropPendingSearch={vi.fn()}
        onSearch={vi.fn()}
      />,
    );

    expect(screen.getByRole("group", { name: "Show" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Filters/ }).textContent).toBe(
      "Filters 1 changed",
    );
  });
});
