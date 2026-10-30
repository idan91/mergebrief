// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Button } from "@web/components/Button";

import { Callout } from ".";

const VIEWPORT = { width: 1280, height: 600 };
const FLOATING = { width: 320, height: 900 };
const ANCHOR_RECT = { x: 100, y: 100, width: 40, height: 20 };

function stubRect(rect: typeof ANCHOR_RECT): DOMRect {
  return {
    ...rect,
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON: () => rect,
  };
}

function isFloating(element: Element): boolean {
  return element.getAttribute("role") === "tooltip";
}

let anchor: HTMLElement;
let outside: HTMLElement;
let contentHeight = 0;
const resizeCallbacks: ResizeObserverCallback[] = [];
const resizeTargets = new Set<Element>();

class StubResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallbacks.push(callback);
  }
  observe(target: Element): void {
    resizeTargets.add(target);
  }
  unobserve(target: Element): void {
    resizeTargets.delete(target);
  }
  disconnect(): void {}
}

function notifyResize(): void {
  act(() => {
    for (const callback of resizeCallbacks) {
      callback([], {} as ResizeObserver);
    }
  });
}

function dispatchFocusEvents(target: HTMLElement, types: string[]): void {
  act(() => {
    for (const type of types) {
      const bubbles = type === "focusin" || type === "focusout";
      target.dispatchEvent(new FocusEvent(type, { bubbles }));
    }
  });
}

function renderOverflowing(): HTMLElement {
  contentHeight = 900;
  return renderInteractive();
}

function renderInteractive(): HTMLElement {
  render(
    <Callout anchor={anchor} interactive onClose={() => {}}>
      <span data-testid="body">
        Long body <Button variant="secondary">Inside</Button>
      </span>
    </Callout>,
  );
  const content = screen.getByTestId("body").parentElement;
  if (!content) {
    throw new Error("callout content missing");
  }
  return content;
}

function holdsBody(element: Element): boolean {
  return element.firstElementChild?.getAttribute("data-testid") === "body";
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  anchor = document.createElement("span");
  outside = document.createElement("button");
  document.body.append(anchor, outside);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function measure(this: Element) {
      if (this === anchor) {
        return stubRect(ANCHOR_RECT);
      }
      return stubRect({ x: 0, y: 0, width: 0, height: 0 });
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
    function measure(this: HTMLElement) {
      return isFloating(this) ? FLOATING.width : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function measure(this: HTMLElement) {
      return isFloating(this) ? FLOATING.height : 0;
    },
  );
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(
    function measure(this: Element) {
      return holdsBody(this) ? contentHeight : 0;
    },
  );
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(
    function measure(this: Element) {
      return this === document.documentElement ? VIEWPORT.width : 0;
    },
  );
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(
    function measure(this: Element) {
      return this === document.documentElement ? VIEWPORT.height : 0;
    },
  );
});

afterEach(() => {
  cleanup();
  contentHeight = 0;
  anchor.remove();
  outside.remove();
  resizeCallbacks.length = 0;
  resizeTargets.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Callout", () => {
  it("caps its height to the space on the side flip picks", async () => {
    render(
      <Callout anchor={anchor} onClose={() => {}}>
        Long body
      </Callout>,
    );

    const callout = screen.getByRole("tooltip");
    await waitFor(() => {
      expect(callout.style.maxBlockSize).toBe("462px");
    });
  });

  it("makes an interactive callout's overflowing content a tab stop", () => {
    const content = renderOverflowing();

    expect(content.getAttribute("tabindex")).toBe("0");
  });

  it("keeps the tab stop while focused content stops overflowing", () => {
    const content = renderOverflowing();
    act(() => {
      content.focus();
    });

    contentHeight = 0;
    notifyResize();
    expect(content.getAttribute("tabindex")).toBe("0");
    expect(document.activeElement).toBe(content);

    act(() => {
      content.blur();
    });
    expect(content.hasAttribute("tabindex")).toBe(false);
  });

  it("keeps the tab stop when the window, not the content, loses focus", () => {
    const content = renderOverflowing();
    act(() => {
      content.focus();
    });
    contentHeight = 0;
    notifyResize();

    dispatchFocusEvents(content, ["blur", "focusout"]);
    dispatchFocusEvents(content, ["focus", "focusin"]);

    expect(content.getAttribute("tabindex")).toBe("0");
    expect(document.activeElement).toBe(content);
  });

  it("drops a tab stop that ends while parked once focus returns", () => {
    const content = renderOverflowing();
    act(() => {
      content.focus();
    });
    act(() => {
      outside.focus();
    });
    expect(content.getAttribute("tabindex")).toBe("-1");

    contentHeight = 0;
    notifyResize();
    act(() => {
      screen.getByRole("button", { name: "Inside" }).focus();
    });

    expect(content.hasAttribute("tabindex")).toBe(false);
  });

  it("parks a tab stop gained while focus is outside the portal", () => {
    const content = renderInteractive();
    const inside = screen.getByRole("button", { name: "Inside" });
    act(() => {
      inside.focus();
    });
    act(() => {
      outside.focus();
    });

    contentHeight = 900;
    notifyResize();
    expect(content.getAttribute("tabindex")).toBe("-1");

    act(() => {
      inside.focus();
    });
    expect(content.getAttribute("tabindex")).toBe("0");

    contentHeight = 0;
    notifyResize();
    contentHeight = 900;
    notifyResize();
    expect(content.getAttribute("tabindex")).toBe("0");
  });

  it("becomes a tab stop when content added after mount overflows", async () => {
    const view = render(
      <Callout anchor={anchor} interactive onClose={() => {}}>
        <span data-testid="body">Short body</span>
      </Callout>,
    );
    const content = screen.getByTestId("body").parentElement;
    expect(content?.hasAttribute("tabindex")).toBe(false);

    contentHeight = 900;
    view.rerender(
      <Callout anchor={anchor} interactive onClose={() => {}}>
        <span data-testid="body">Short body</span>
        <span>Late rows</span>
      </Callout>,
    );

    await waitFor(() => {
      expect(content?.getAttribute("tabindex")).toBe("0");
    });
    const late = screen.getByText("Late rows");
    expect(resizeTargets.has(late)).toBe(true);

    view.rerender(
      <Callout anchor={anchor} interactive onClose={() => {}}>
        <span data-testid="body">Short body</span>
      </Callout>,
    );
    await waitFor(() => {
      expect(resizeTargets.has(late)).toBe(false);
    });
  });

  it("keeps fitting or hover-only content out of the tab order", () => {
    render(
      <Callout anchor={anchor} interactive onClose={() => {}}>
        <span data-testid="body">Short body</span>
      </Callout>,
    );
    const fitting = screen.getByTestId("body").parentElement;
    expect(fitting?.hasAttribute("tabindex")).toBe(false);
    cleanup();

    contentHeight = 900;
    render(
      <Callout anchor={anchor} onClose={() => {}}>
        <span data-testid="body">Long body</span>
      </Callout>,
    );
    const hoverOnly = screen.getByTestId("body").parentElement;
    expect(hoverOnly?.hasAttribute("tabindex")).toBe(false);
  });
});
