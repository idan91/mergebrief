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

describe("single-column render (BRIEF-104: split retired)", () => {
  it("renders a changelog-bearing summary single-column, changelog as plain markdown", () => {
    const withChangelog = {
      ...briefFixture,
      summary: "A short lede.\n\n## Changelog\n\n- one\n- two",
    };
    render(<SummarySection brief={withChangelog} />);
    const section = screen.getByTestId("brief-summary");
    expect(section.hasAttribute("data-summary-split")).toBe(false);
    // Markdown demotes h2 -> h4 (document-outline protection)
    const heading = screen.getByRole("heading", {
      level: 4,
      name: "Changelog",
    });
    // Structural pin: lede and changelog live in the SAME markdown root —
    // any re-split into two containers fails this regardless of naming.
    const lede = screen.getByText("A short lede.");
    expect(lede.closest("[dir='auto']")).toBe(heading.closest("[dir='auto']"));
  });

  it("renders DeltaContext on the single path for delta briefs, inside the capped body", () => {
    const deltaBrief = {
      ...briefFixture,
      artifactKind: "delta" as const,
      commentsAddressed: "Addressed the retry-count comment.",
    };
    render(<SummarySection brief={deltaBrief} />);
    const summaryText = screen.getByTestId("summary-text");
    const commentsEyebrow = screen.getByText("Comments addressed");
    expect(summaryText.contains(commentsEyebrow)).toBe(true);
    expect(screen.getByText("Delta brief")).toBeTruthy();
  });
});

describe("SummarySection expandable-content adoption", () => {
  it("nests the description toggle inside the capped body", () => {
    render(<SummarySection brief={briefFixture} />);
    const summaryText = screen.getByTestId("summary-text");
    const toggle = screen.getByTestId("pr-description-toggle");
    expect(summaryText.contains(toggle)).toBe(true);
  });

  it("never auto-opens the description when the summary expands", () => {
    render(<SummarySection brief={briefFixture} />);
    expect(screen.queryByTestId("pr-description")).toBeNull();
    fireEvent.click(screen.getByTestId("summary-text-toggle"));
    expect(screen.queryByTestId("pr-description")).toBeNull();
  });

  it("opens the description only through its own toggle", () => {
    render(<SummarySection brief={briefFixture} />);
    fireEvent.click(screen.getByTestId("pr-description-toggle"));
    expect(screen.getByTestId("pr-description")).toBeTruthy();
  });
});
