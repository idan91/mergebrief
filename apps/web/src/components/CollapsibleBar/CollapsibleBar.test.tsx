// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CollapsibleBar } from ".";
import { OPEN_BAR_SELECTOR } from "./consts";
import { BarHeadingLevels } from "./types";

afterEach(cleanup);

describe("CollapsibleBar", () => {
  it("makes the heading the disclosure for its panel", () => {
    const onToggle = vi.fn();
    render(
      <CollapsibleBar
        headingLevel={BarHeadingLevels.H2}
        open={false}
        summary="3 items"
        title="Intent check"
        onToggle={onToggle}
      >
        <p>Panel body</p>
      </CollapsibleBar>,
    );

    const toggle = screen.getByRole("button", { name: /intent check/i });
    expect(toggle.closest("h2")).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(
      toggle.getAttribute("aria-controls") ?? "",
    );
    expect(panel?.hidden).toBe(true);
    expect(toggle.textContent).toContain("3 items");

    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shows the panel when open and names the region by its title", () => {
    render(
      <CollapsibleBar
        headingLevel={BarHeadingLevels.H3}
        open
        summary="3 items"
        title="Conversation"
        onToggle={vi.fn()}
      >
        <p>Panel body</p>
      </CollapsibleBar>,
    );

    expect(screen.getByRole("region", { name: "Conversation" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /conversation/i }).closest("h3"),
    ).not.toBeNull();
    expect(screen.getByText("Panel body").parentElement?.hidden).toBe(false);
  });

  it("keeps actions and the note outside the toggle", () => {
    render(
      <CollapsibleBar
        actions={<a href="/x">Refresh</a>}
        headingLevel={BarHeadingLevels.H2}
        note={<p>Two comments came later</p>}
        open={false}
        title="Conversation"
        toggleId="conversation-heading"
        onToggle={vi.fn()}
      >
        <p>Panel body</p>
      </CollapsibleBar>,
    );

    const toggle = screen.getByRole("button", { name: /conversation/i });
    expect(toggle.id).toBe("conversation-heading");
    expect(toggle.contains(screen.getByText("Refresh"))).toBe(false);
    expect(screen.getByText("Two comments came later")).toBeTruthy();
  });

  it("matches the open-bar selector only while open", () => {
    const { container, rerender } = render(
      <CollapsibleBar
        headingLevel={BarHeadingLevels.H2}
        open={false}
        title="Intent check"
        onToggle={vi.fn()}
      >
        <p>Panel body</p>
      </CollapsibleBar>,
    );
    expect(container.querySelector(OPEN_BAR_SELECTOR)).toBeNull();

    rerender(
      <CollapsibleBar
        headingLevel={BarHeadingLevels.H2}
        open
        title="Intent check"
        onToggle={vi.fn()}
      >
        <p>Panel body</p>
      </CollapsibleBar>,
    );
    expect(container.querySelector(OPEN_BAR_SELECTOR)).not.toBeNull();
  });
});
