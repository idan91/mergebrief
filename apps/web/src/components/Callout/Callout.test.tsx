// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import { Button } from "@web/components/Button";
import { startColdCalloutTimers } from "@web/test/callouts";

import { Callout } from ".";
import { areCalloutsWarm } from "./utils";

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

/** A label callout opened from a button inside an interactive callout. */
function NestedCallouts({ onOuterClose }: { onOuterClose: () => void }) {
  const [innerAnchor, setInnerAnchor] = useState<HTMLButtonElement | null>(
    null,
  );
  const [innerOpen, setInnerOpen] = useState(true);
  return (
    <Callout anchor={anchor} interactive onClose={onOuterClose}>
      <Button ref={setInnerAnchor} variant="secondary">
        Inner anchor
      </Button>
      {innerOpen && innerAnchor ? (
        <Callout anchor={innerAnchor} onClose={() => setInnerOpen(false)}>
          Inner label
        </Callout>
      ) : null}
    </Callout>
  );
}

function getCalloutRoot(text: string): HTMLElement {
  const root = screen.getByText(text).closest<HTMLElement>("[data-callout]");
  if (root === null) {
    throw new Error(`no callout holds ${text}`);
  }
  return root;
}

const ABOVE_ANCHOR = { clientX: 120, clientY: 50 };
const BELOW_ANCHOR = { clientX: 120, clientY: 300 };

describe("Callout nested in a callout", () => {
  it("keeps the outer open while the pointer rests on the inner", () => {
    const onOuterClose = vi.fn();
    render(<NestedCallouts onOuterClose={onOuterClose} />);
    const outer = getCalloutRoot("Inner anchor");
    const inner = getCalloutRoot("Inner label");
    expect(outer.contains(inner)).toBe(false);

    fireEvent.mouseLeave(outer, { relatedTarget: inner, ...ABOVE_ANCHOR });
    fireEvent.mouseMove(inner, ABOVE_ANCHOR);

    expect(onOuterClose).not.toHaveBeenCalled();
  });

  it("closes the outer once the pointer leaves the inner for the page", () => {
    const onOuterClose = vi.fn();
    render(<NestedCallouts onOuterClose={onOuterClose} />);
    const outer = getCalloutRoot("Inner anchor");
    const inner = getCalloutRoot("Inner label");
    const innerAnchor = screen.getByRole("button", { name: "Inner anchor" });

    fireEvent.mouseLeave(anchor, { relatedTarget: outer, ...ABOVE_ANCHOR });
    fireEvent.mouseLeave(innerAnchor, {
      relatedTarget: inner,
      ...ABOVE_ANCHOR,
    });
    fireEvent.mouseLeave(outer, { relatedTarget: inner, ...ABOVE_ANCHOR });
    fireEvent.mouseMove(outside, BELOW_ANCHOR);
    expect(screen.queryByText("Inner label")).toBeNull();

    fireEvent.mouseMove(outside, BELOW_ANCHOR);
    expect(onOuterClose).toHaveBeenCalledOnce();
  });
});

const FLOATING_ABOVE_ANCHOR = { x: 60, y: 20, width: 120, height: 60 };
/** Off the anchor's column but inside the triangle toward the callout. */
const HEADING_FOR_CALLOUT = { clientX: 95, clientY: 100 };
const PAST_CLOSE_TIMER_MS = 80;

/** The callout sits above the anchor, so a leave toward it arms the timer. */
function stubCalloutAboveAnchor(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function measure(this: Element) {
      if (this === anchor) {
        return stubRect(ANCHOR_RECT);
      }
      if (this.hasAttribute("data-callout")) {
        return stubRect(FLOATING_ABOVE_ANCHOR);
      }
      return stubRect({ x: 0, y: 0, width: 0, height: 0 });
    },
  );
}

async function waitPastCloseTimer(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, PAST_CLOSE_TIMER_MS));
  });
}

/** A callout anchored to a React-rendered button that handles keys itself. */
function ReactAnchoredCallout({
  onAnchorKey,
  onClose,
}: {
  onAnchorKey: () => void;
  onClose: () => void;
}) {
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <Button onKeyDown={onAnchorKey} ref={setButton} variant="secondary">
        Anchor
      </Button>
      {button ? (
        <Callout anchor={button} onClose={onClose}>
          Label
        </Callout>
      ) : null}
    </>
  );
}

/** Owns the open state the way a host does: hover opens, `onClose` closes. */
function HoverHost() {
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onMouseEnter={() => setOpen(true)}
        ref={setButton}
        variant="secondary"
      >
        Anchor
      </Button>
      {open && button ? (
        <Callout anchor={button} onClose={() => setOpen(false)}>
          Label
        </Callout>
      ) : null}
    </>
  );
}

describe("Callout dismissal", () => {
  it("closes on Escape with the pointer and focus where they were", () => {
    const onClose = vi.fn();
    render(
      <Callout anchor={anchor} onClose={onClose}>
        Label
      </Callout>,
    );

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(onClose).toHaveBeenCalledExactlyOnceWith("escape-key");
  });

  it("keeps the Escape that closed it from the window's listeners", () => {
    const onPageKey = vi.fn();
    window.addEventListener("keydown", onPageKey);
    onTestFinished(() => window.removeEventListener("keydown", onPageKey));
    render(
      <Callout anchor={anchor} onClose={() => {}}>
        Label
      </Callout>,
    );

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(onPageKey).not.toHaveBeenCalled();
  });

  it("keeps the Escape that closed it from the anchor's own handler", () => {
    const onAnchorKey = vi.fn();
    const onClose = vi.fn();
    render(
      <ReactAnchoredCallout onAnchorKey={onAnchorKey} onClose={onClose} />,
    );
    const button = screen.getByRole("button", { name: "Anchor" });
    button.focus();

    fireEvent.keyDown(button, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
    expect(onAnchorKey).not.toHaveBeenCalled();
  });

  it("leaves no Escape listener behind on the key's target", () => {
    const onClose = vi.fn();
    render(<ReactAnchoredCallout onAnchorKey={() => {}} onClose={onClose} />);
    const button = screen.getByRole("button", { name: "Anchor" });
    button.focus();
    fireEvent.keyDown(button, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();

    fireEvent.keyDown(button, { key: "Enter" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows again on the next hover after Escape closed it", () => {
    render(<HoverHost />);
    const button = screen.getByRole("button", { name: "Anchor" });
    fireEvent.mouseEnter(button);
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseLeave(button);
    fireEvent.mouseEnter(button);
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("stays open on a press outside it", () => {
    const onClose = vi.fn();
    render(
      <Callout anchor={anchor} onClose={onClose}>
        Label
      </Callout>,
    );

    fireEvent.pointerDown(outside);
    fireEvent.click(outside);

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("Callout close timer", () => {
  it("closes a mounted callout once its timer fires", async () => {
    stubCalloutAboveAnchor();
    const onClose = vi.fn();
    render(
      <Callout anchor={anchor} onClose={onClose}>
        Label
      </Callout>,
    );

    fireEvent.mouseLeave(anchor, {
      relatedTarget: outside,
      ...HEADING_FOR_CALLOUT,
    });
    expect(onClose).not.toHaveBeenCalled();
    await waitPastCloseTimer();

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("drops a close its timer fires after the callout unmounted", async () => {
    stubCalloutAboveAnchor();
    const onClose = vi.fn();
    const { rerender } = render(
      <Callout anchor={anchor} onClose={onClose}>
        Label
      </Callout>,
    );

    fireEvent.mouseLeave(anchor, {
      relatedTarget: outside,
      ...HEADING_FOR_CALLOUT,
    });
    rerender(null);
    await waitPastCloseTimer();

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("Callout warmth", () => {
  it("leaves the next label cold while a panel is open", () => {
    startColdCalloutTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });

    render(
      <Callout anchor={anchor} interactive onClose={() => {}}>
        Panel
      </Callout>,
    );

    expect(areCalloutsWarm()).toBe(false);
  });

  it("warms the next label while a label is open", () => {
    startColdCalloutTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });

    render(
      <Callout anchor={anchor} onClose={() => {}}>
        Label
      </Callout>,
    );

    expect(areCalloutsWarm()).toBe(true);
  });
});
