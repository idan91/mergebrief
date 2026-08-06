// @vitest-environment jsdom
// Pins the ExpandableContent adoption (BRIEF-134): the description disclosure lives
// INSIDE the capped body, and expanding the summary never auto-opens it.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { briefFixture } from "../../../utils/fixtures";
import { SummarySection } from "./SummarySection";

let contentHeight = 0;
const originalResizeObserver = globalThis.ResizeObserver;
const originalScrollHeight = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollHeight",
);

class InertResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  // Taller than any cap so the summary renders collapsed with a live toggle.
  contentHeight = 4000;
  globalThis.ResizeObserver = InertResizeObserver;
  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    get: () => contentHeight,
  });
});

afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = originalResizeObserver;
  if (originalScrollHeight !== undefined) {
    Object.defineProperty(
      Element.prototype,
      "scrollHeight",
      originalScrollHeight,
    );
  }
});

describe("SummarySection capped-prose adoption", () => {
  it("nests the description toggle inside the capped body", () => {
    render(<SummarySection brief={briefFixture} />);
    const prose = screen.getByTestId("summary-prose");
    const toggle = screen.getByTestId("pr-description-toggle");
    expect(prose.contains(toggle)).toBe(true);
  });

  it("never auto-opens the description when the summary expands", () => {
    render(<SummarySection brief={briefFixture} />);
    expect(screen.queryByTestId("pr-description")).toBeNull();
    fireEvent.click(screen.getByTestId("summary-prose-toggle"));
    expect(screen.queryByTestId("pr-description")).toBeNull();
  });

  it("opens the description only through its own toggle", () => {
    render(<SummarySection brief={briefFixture} />);
    fireEvent.click(screen.getByTestId("pr-description-toggle"));
    expect(screen.getByTestId("pr-description")).toBeTruthy();
  });
});
