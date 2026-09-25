// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import { Controls } from "./Controls";
import type { FilterView } from "./types";

afterEach(() => {
  cleanup();
  resetMediaQueries();
});

beforeEach(() => {
  setMediaQueryMatches("(prefers-reduced-motion: reduce)", true);
});

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
        filters={[makeFilter("review", "Review")]}
        layout={makeFilter("layout", "View")}
        sort={makeFilter("sort", "Sort")}
        onClear={vi.fn()}
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
});
