// @vitest-environment jsdom
// The expandable-content state machine: SSR-collapsed, corrected to `fits`
// post-hydration, focus-expands inside the clipped body.
import { act } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExpandableContent } from ".";

const CAP_FALLBACK_PX = 200;

let contentHeight = 0;
let resizeCallbacks: ResizeObserverCallback[] = [];
const originalResizeObserver = globalThis.ResizeObserver;
const originalScrollHeight = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollHeight",
);

class ControllableResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallbacks.push(callback);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const INERT_OBSERVER: ResizeObserver = {
  observe: () => {},
  unobserve: () => {},
  disconnect: () => {},
};

/** Re-runs every live observer callback, as a real content resize would. */
function fireResize(): void {
  act(() => {
    for (const callback of resizeCallbacks) {
      callback([], INERT_OBSERVER);
    }
  });
}

beforeEach(() => {
  resizeCallbacks = [];
  globalThis.ResizeObserver = ControllableResizeObserver;
  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    get: () => contentHeight,
  });
});

afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = originalResizeObserver;
  if (originalScrollHeight !== undefined) {
    Object.defineProperty(Element.prototype, "scrollHeight", {
      ...originalScrollHeight,
    });
  }
});

function state(): string | null {
  return screen.getByTestId("expandable-content").getAttribute("data-state");
}

function renderText(props: { expandLabel?: string } = {}) {
  return render(
    <ExpandableContent expandLabel={props.expandLabel}>
      <p>Summary text</p>
    </ExpandableContent>,
  );
}

describe("ExpandableContent", () => {
  it("clips over-cap content and offers the expand control", () => {
    contentHeight = CAP_FALLBACK_PX + 400;
    renderText();

    expect(state()).toBe("collapsed");
    const toggle = screen.getByRole("button", { name: "Show full summary" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("corrects to `fits` post-hydration when the content is short", () => {
    contentHeight = CAP_FALLBACK_PX - 40;
    renderText();

    expect(state()).toBe("fits");
  });

  it("treats content inside the hysteresis band as fitting", () => {
    contentHeight = CAP_FALLBACK_PX + 8;
    renderText();

    expect(state()).toBe("fits");
  });

  it("expands on toggle and swaps to the collapse label", () => {
    contentHeight = CAP_FALLBACK_PX + 400;
    renderText();

    const toggle = screen.getByRole("button", { name: "Show full summary" });
    fireEvent.click(toggle);

    expect(state()).toBe("expanded");
    expect(
      screen
        .getByRole("button", { name: "Collapse summary" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("turns the arrow down while collapsed and up once expanded", () => {
    contentHeight = CAP_FALLBACK_PX + 400;
    renderText();

    const toggle = screen.getByRole("button", { name: "Show full summary" });
    const arrow = toggle.querySelector('[data-icon="arrow-up"]');
    expect(arrow?.getAttribute("data-rotation")).toBe("180");

    fireEvent.click(toggle);

    const collapse = screen.getByRole("button", { name: "Collapse summary" });
    const arrowUp = collapse.querySelector('[data-icon="arrow-up"]');
    expect(arrowUp?.hasAttribute("data-rotation")).toBe(false);
  });

  it("collapses again on a second toggle", () => {
    contentHeight = CAP_FALLBACK_PX + 400;
    renderText();

    fireEvent.click(screen.getByRole("button", { name: "Show full summary" }));
    fireEvent.click(screen.getByRole("button", { name: "Collapse summary" }));

    expect(state()).toBe("collapsed");
  });

  it("expands when focus lands inside the clipped body, per WCAG 2.4.11", () => {
    contentHeight = CAP_FALLBACK_PX + 400;
    render(
      <ExpandableContent>
        <a href="https://example.test">buried link</a>
      </ExpandableContent>,
    );

    fireEvent.focus(screen.getByRole("link", { name: "buried link" }));

    expect(state()).toBe("expanded");
  });

  it("does not expand when focus lands on the toggle itself", () => {
    contentHeight = CAP_FALLBACK_PX + 400;
    renderText();

    fireEvent.focus(screen.getByRole("button", { name: "Show full summary" }));

    expect(state()).toBe("collapsed");
  });

  it("re-measures on content resize", () => {
    contentHeight = CAP_FALLBACK_PX + 400;
    renderText();
    expect(state()).toBe("collapsed");

    contentHeight = CAP_FALLBACK_PX - 40;
    fireResize();

    expect(state()).toBe("fits");
  });

  it("reports `fits` when expanded content shrinks below the cap", () => {
    contentHeight = CAP_FALLBACK_PX + 400;
    renderText();
    fireEvent.click(screen.getByRole("button", { name: "Show full summary" }));

    contentHeight = CAP_FALLBACK_PX - 40;
    fireResize();

    expect(state()).toBe("fits");
  });

  it("scrolls the block back into view when collapsing from off-screen", () => {
    // Collapsing removes the content the reader scrolled through, so without
    // this the viewport lands far below where the block now ends.
    contentHeight = CAP_FALLBACK_PX + 400;
    renderText();
    fireEvent.click(screen.getByRole("button", { name: "Show full summary" }));

    const root = screen.getByTestId("expandable-content");
    root.getBoundingClientRect = () => new DOMRect(0, -800, 600, 1000);
    const scrollIntoView = vi.fn();
    root.scrollIntoView = scrollIntoView;

    fireEvent.click(screen.getByRole("button", { name: "Collapse summary" }));

    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("leaves the scroll position alone when the block is already in view", () => {
    contentHeight = CAP_FALLBACK_PX + 400;
    renderText();
    fireEvent.click(screen.getByRole("button", { name: "Show full summary" }));

    const root = screen.getByTestId("expandable-content");
    root.getBoundingClientRect = () => new DOMRect(0, 40, 600, 1000);
    const scrollIntoView = vi.fn();
    root.scrollIntoView = scrollIntoView;

    fireEvent.click(screen.getByRole("button", { name: "Collapse summary" }));

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("keeps the collapsed default while the content is unrendered", () => {
    // A host that mounts this inside a `hidden` panel measures zero until the
    // panel opens; treating that as `fits` would flash the content uncapped.
    contentHeight = 0;
    renderText();

    expect(state()).toBe("collapsed");
  });

  it("takes host-supplied toggle copy", () => {
    contentHeight = CAP_FALLBACK_PX + 400;
    renderText({ expandLabel: "Show full intent check" });

    expect(
      screen.getByRole("button", { name: "Show full intent check" }),
    ).toBeDefined();
  });
});
