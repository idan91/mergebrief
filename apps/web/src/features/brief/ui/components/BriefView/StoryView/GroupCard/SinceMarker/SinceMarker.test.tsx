// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SinceMarker } from ".";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDeltaLink(): HTMLElement {
  render(
    <SinceMarker
      baselineShortSha="abc1234"
      changedFileCount={2}
      openComparison={() => undefined}
    />,
  );
  return screen.getByRole("button");
}

describe("SinceMarker delta link", () => {
  it("describes what the link opens without its callout", () => {
    const link = renderDeltaLink();

    expect(link.getAttribute("aria-description")).toBe(
      "Compare against your last review",
    );
  });

  it("opens its callout on keyboard focus", () => {
    const link = renderDeltaLink();
    vi.spyOn(link, "matches").mockImplementation(
      (selector) => selector === ":focus-visible",
    );

    fireEvent.focus(link);

    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("opens no callout when focus arrives without a keyboard", () => {
    const link = renderDeltaLink();
    vi.spyOn(link, "matches").mockReturnValue(false);

    fireEvent.focus(link);

    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
