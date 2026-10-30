// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StackRow } from "../types";
import { NeighbourList } from ".";

const ROW_HEIGHT = 56;
const CURRENT_INDEX = 7;

let notifyResize: (() => void) | undefined;
let viewportHeight = 364;

class StubResizeObserver {
  constructor(callback: () => void) {
    notifyResize = callback;
  }
  observe(): void {}
  disconnect(): void {}
}

function makeRows(count: number): StackRow[] {
  return Array.from({ length: count }, (_, index) => ({
    member: { number: index + 1, title: `PR ${String(index + 1)}` },
    position: index + 1,
    current: index === CURRENT_INDEX,
  }));
}

beforeEach(() => {
  viewportHeight = 364;
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(
    ROW_HEIGHT,
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    () => viewportHeight,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  notifyResize = undefined;
});

function renderList(): HTMLElement {
  render(
    <NeighbourList
      label="Stack"
      repoId={undefined}
      repoSlug="octo/hello"
      rows={makeRows(10)}
    />,
  );
  return screen.getByRole("list", { name: "Stack" });
}

describe("NeighbourList", () => {
  it("re-centres the current row when the callout resizes the list", () => {
    const list = renderList();
    expect(list.scrollTop).toBe(238);
    fireEvent.scroll(list);

    viewportHeight = 200;
    notifyResize?.();

    expect(list.scrollTop).toBe(320);
  });

  it("leaves the reader's own scroll alone when the list resizes", () => {
    const list = renderList();
    list.scrollTop = 40;
    fireEvent.scroll(list);

    viewportHeight = 200;
    notifyResize?.();

    expect(list.scrollTop).toBe(40);
  });
});
