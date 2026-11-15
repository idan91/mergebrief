// @vitest-environment jsdom
// jsdom has no layout, so these tests exercise the hook's own logic: window
// determinism off the fixed SSR rect, the pinned-index range, the
// hidden-pane latch, and the key→index contract. Real-geometry behavior
// (measured heights, scroll to target) belongs to the perf specs.
import type { useWindowVirtualizer } from "@tanstack/react-virtual";
import { act, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { intersectionObservers } from "@web/test/setup";
import { useGroupWindow, type GroupWindowOptions } from "./useGroupWindow";
import { refuseScrollCompensation } from "./window-layout";

/** The live virtualizer, read through to see the compensation rule it holds. */
const captured = vi.hoisted(() => ({
  virtualizer: undefined as
    | { shouldAdjustScrollPositionOnItemSizeChange: unknown }
    | undefined,
}));

vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const original = await importOriginal<{
    useWindowVirtualizer: typeof useWindowVirtualizer;
  }>();
  return {
    ...original,
    useWindowVirtualizer: (
      ...args: Parameters<typeof original.useWindowVirtualizer>
    ) => {
      const virtualizer = original.useWindowVirtualizer(...args);
      captured.virtualizer = virtualizer;
      return virtualizer;
    },
  };
});

function readCompensation(): unknown {
  return captured.virtualizer?.shouldAdjustScrollPositionOnItemSizeChange;
}

function stubScrollAnchoring(supported: boolean): void {
  vi.stubGlobal("CSS", { supports: () => supported });
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
}

// jsdom implements scrollTo as a loud not-implemented warning; the
// virtualizer's internal scroll anchoring calls it on measurement changes.
beforeEach(() => {
  vi.stubGlobal("scrollTo", vi.fn());
  intersectionObservers.length = 0;
});

function reportIntersection(
  observer: (typeof intersectionObservers)[number] | undefined,
  isIntersecting: boolean,
): void {
  if (observer === undefined) {
    throw new Error("the list was never observed");
  }
  observer.callback(
    [{ isIntersecting } as IntersectionObserverEntry],
    {} as IntersectionObserver,
  );
}

/** Where the caller moved the page after the jump: deep inside the target card. */
const JUMP_CALLER_TOP = 25_000;
/** Tall enough that no jump in these tests clamps to the page's end. */
const PAGE_HEIGHT = 100_000;
/**
 * The virtualizer's `isScrollingResetDelay` default. Each window scroll arms
 * a timer this long that its unsubscribe never clears; left pending, it
 * fires after the file's jsdom teardown and throws `window is not defined`.
 */
const SCROLL_RESET_DELAY_MS = 150;
/** A reload's restored position, short of the first card boundary. */
const RESTORED_SCROLL_Y = 150;

/** A reload's restored position twenty 600px cards down: past the server's window. */
const DEEP_RESTORED_SCROLL_Y = 12_000;
const DEEP_RESTORED_INDEX = 20;
/** Every card's estimated height in the hydration tests. */
const CARD_ESTIMATE = 600;
/** A card far past the restored window, so the jump has to move the page. */
const JUMP_TARGET_INDEX = 30;
/** Cards 0 and 1 fill the 900px server viewport; four more ride as overscan. */
const SERVER_WINDOW = [0, 1, 2, 3, 4, 5];

const KEYS = Array.from(
  { length: 40 },
  (_, i) => `src/file-${String(i)}.ts#c${String(i)}`,
);

interface HarnessProps {
  options: GroupWindowOptions;
  onWindow: (window: ReturnType<typeof useGroupWindow>) => void;
}

function Harness({ options, onWindow }: HarnessProps) {
  const window = useGroupWindow(options);
  onWindow(window);
  return (
    <div data-testid="wrapper">
      <div ref={window.listRef} data-testid="list">
        {window.items.map((item) => (
          <article key={item.key} data-index={item.index} />
        ))}
      </div>
    </div>
  );
}

function renderHarness(overrides: Partial<GroupWindowOptions> = {}) {
  let latest: ReturnType<typeof useGroupWindow> | null = null;
  const options: GroupWindowOptions = {
    chunkKeys: KEYS,
    estimateChunk: () => 600,
    ...overrides,
  };
  const view = render(
    <Harness
      options={options}
      onWindow={(window) => {
        latest = window;
      }}
    />,
  );
  const current = () => {
    if (!latest) {
      throw new Error("hook did not render");
    }
    return latest;
  };
  return { view, current };
}

/**
 * Hydrates the harness over server markup with the page restored `scrollY`
 * down, as a reload does.
 */
async function hydrateReload(
  scrollY: number,
  onWindow: HarnessProps["onWindow"],
  onRecoverableError: (error: unknown) => void = () => undefined,
): Promise<void> {
  vi.stubGlobal("scrollY", scrollY);
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  const options: GroupWindowOptions = {
    chunkKeys: KEYS,
    estimateChunk: () => CARD_ESTIMATE,
  };
  const container = document.createElement("div");
  container.innerHTML = renderToString(
    <Harness options={options} onWindow={() => undefined} />,
  );
  document.body.append(container);

  await act(async () => {
    const root = hydrateRoot(
      container,
      <Harness options={options} onWindow={onWindow} />,
      { onRecoverableError },
    );
    onTestFinished(() => {
      root.unmount();
      container.remove();
    });
    await Promise.resolve();
  });
}

describe("useGroupWindow", () => {
  it("renders a bounded window, not the whole list", () => {
    const { current } = renderHarness();
    const { items } = current();
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(KEYS.length);
    expect(current().totalSize).toBe(KEYS.length * 600);
  });

  it("reads the viewport top as the server does while it hydrates", async () => {
    const tops: number[] = [];

    await hydrateReload(RESTORED_SCROLL_Y, (groupWindow) =>
      tops.push(groupWindow.viewportTop),
    );

    expect(tops[0]).toBe(0);
    expect(tops.at(-1)).toBe(RESTORED_SCROLL_Y);
  });

  it("hydrates the server's window after a reload deep in the list", async () => {
    const onRecoverableError = vi.fn();
    const windows: number[][] = [];
    const tops: number[] = [];

    await hydrateReload(
      DEEP_RESTORED_SCROLL_Y,
      (groupWindow) => {
        windows.push(groupWindow.items.map((item) => item.index));
        tops.push(groupWindow.viewportTop);
      },
      onRecoverableError,
    );

    // jsdom gives the list no offset, so its margin lands on the scroll
    // position and the last window slides back; the render before that
    // effect is the one that shows the restored window.
    const restored = windows.find((indexes) =>
      indexes.includes(DEEP_RESTORED_INDEX),
    );
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(windows[0]).toEqual(SERVER_WINDOW);
    expect(restored).not.toContain(0);
    expect(tops.at(-1)).toBe(DEEP_RESTORED_SCROLL_Y);
  });

  it("scrolls the page to a jump's target once hydration ends", async () => {
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: PAGE_HEIGHT,
    });
    onTestFinished(() => {
      Reflect.deleteProperty(document.documentElement, "scrollHeight");
    });
    let latest: ReturnType<typeof useGroupWindow> | undefined;
    await hydrateReload(DEEP_RESTORED_SCROLL_Y, (groupWindow) => {
      latest = groupWindow;
    });

    let jumped: boolean | undefined;
    act(() => {
      jumped = latest?.scrollToKey(KEYS[JUMP_TARGET_INDEX] ?? "");
    });

    // The list's margin is the restored scroll position, as above.
    const targetTop =
      DEEP_RESTORED_SCROLL_Y + JUMP_TARGET_INDEX * CARD_ESTIMATE;
    expect(jumped).toBe(true);
    expect(window.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: targetTop }),
    );
  });

  it("server markup and the client's first render agree on the window", () => {
    // Hydration-parity leg: renderToString runs no effects, so it renders
    // exactly what the server would; the client's FIRST render (captured
    // before effects re-measure) must produce the same item set or React
    // reports a hydration mismatch.
    const options: GroupWindowOptions = {
      chunkKeys: KEYS,
      estimateChunk: () => 600,
    };
    const markup = renderToString(
      <Harness options={options} onWindow={() => undefined} />,
    );
    const serverIndexes = [...markup.matchAll(/data-index="(\d+)"/g)].map(
      (match) => Number(match[1]),
    );
    expect(serverIndexes.length).toBeGreaterThan(0);

    let firstRenderIndexes: number[] | null = null;
    render(
      <Harness
        options={options}
        onWindow={(window) => {
          firstRenderIndexes ??= window.items.map((item) => item.index);
        }}
      />,
    );
    expect(firstRenderIndexes).toEqual(serverIndexes);
  });

  it("restores measured sizes across a hide/show flip", async () => {
    // Disabling the virtualizer wipes its measurement cache; the hook must
    // snapshot and restore, or flip-back remaps the scroll offset onto
    // different cards. resizeItem stands in for a real measurement (jsdom
    // has no layout).
    const { current, view } = renderHarness();
    const wrapper = screen.getByTestId("wrapper");

    const card = view.container.querySelector('[data-index="0"]');
    if (!(card instanceof HTMLElement)) {
      throw new Error("card not rendered");
    }
    Object.defineProperty(card, "offsetHeight", { value: 999 });
    act(() => {
      current().measureElement(card);
    });
    expect(current().items[1]?.start).toBe(999);

    await act(async () => {
      wrapper.setAttribute("hidden", "");
      await Promise.resolve();
    });
    expect(current().active).toBe(false);

    await act(async () => {
      wrapper.removeAttribute("hidden");
      await Promise.resolve();
    });
    expect(current().active).toBe(true);
    expect(current().items[1]?.start).toBe(999);
  });

  it("renders no cards while the observer reports the group far away", () => {
    const pinned = KEYS[KEYS.length - 1] ?? "";
    const { current } = renderHarness({ pinnedKeys: new Set([pinned]) });
    const observer = intersectionObservers[0];
    expect(current().items.length).toBeGreaterThan(1);

    act(() => {
      reportIntersection(observer, false);
    });
    expect(current().items.map((item) => item.index)).toEqual([
      KEYS.length - 1,
    ]);
    expect(current().totalSize).toBe(KEYS.length * 600);

    act(() => {
      reportIntersection(observer, true);
    });
    expect(current().items.length).toBeGreaterThan(1);
  });

  it("ignores a far report from a hidden pane and re-observes on unhide", async () => {
    const { current } = renderHarness();
    const before = current().items;
    const wrapper = screen.getByTestId("wrapper");

    await act(async () => {
      wrapper.setAttribute("hidden", "");
      await Promise.resolve();
    });
    const first = intersectionObservers[0];
    act(() => {
      reportIntersection(first, false);
    });
    await act(async () => {
      wrapper.removeAttribute("hidden");
      await Promise.resolve();
    });

    expect(current().active).toBe(true);
    expect(current().items.map((item) => item.index)).toEqual(
      before.map((item) => item.index),
    );
    expect(intersectionObservers.length).toBe(2);
  });

  it("mounts a jump's target in a far group before the observer reports", () => {
    const { current } = renderHarness();
    const observer = intersectionObservers[0];
    act(() => {
      reportIntersection(observer, false);
    });
    expect(current().items).toHaveLength(0);

    const target = KEYS[30] ?? "";
    act(() => {
      expect(current().scrollToKey(target)).toBe(true);
    });
    expect(current().items.map((item) => item.index)).toContain(30);

    act(() => {
      reportIntersection(observer, false);
    });
    expect(current().items.map((item) => item.index)).toEqual([30]);

    act(() => {
      reportIntersection(observer, true);
    });
    act(() => {
      reportIntersection(observer, false);
    });
    expect(current().items).toHaveLength(0);
  });

  it("leaves the page to the caller once a jump's target offset moves", async () => {
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: PAGE_HEIGHT,
    });
    onTestFinished(() => {
      Reflect.deleteProperty(document.documentElement, "scrollHeight");
      vi.unstubAllGlobals();
    });
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => frames.push(callback)),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const moveTo = (top: number) => {
      vi.stubGlobal("scrollY", top);
      window.dispatchEvent(new Event("scroll"));
    };
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      moveTo(options.top ?? 0);
    });
    vi.stubGlobal("scrollTo", scrollTo);
    let latest: ReturnType<typeof useGroupWindow> | undefined;
    const renderWith = (options: GroupWindowOptions) => (
      <Harness
        options={options}
        onWindow={(window) => {
          latest = window;
        }}
      />
    );
    const view = render(
      renderWith({ chunkKeys: KEYS, estimateChunk: () => 600 }),
    );
    scrollTo.mockClear();

    act(() => {
      latest?.scrollToKey(KEYS[30] ?? "");
    });
    moveTo(JUMP_CALLER_TOP);
    view.rerender(
      renderWith({
        chunkKeys: [...KEYS, "late.ts#c40"],
        estimateChunk: () => 700,
      }),
    );
    act(() => {
      for (const frame of frames.splice(0)) {
        frame(0);
      }
    });

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(window.scrollY).toBe(JUMP_CALLER_TOP);

    await act(async () => {
      await new Promise((resolve) => {
        window.setTimeout(resolve, SCROLL_RESET_DELAY_MS);
      });
    });
  });

  it("releases a jump into a near group once the group goes far", () => {
    const { current } = renderHarness();
    const observer = intersectionObservers[0];
    const report = (isIntersecting: boolean) => {
      act(() => {
        reportIntersection(observer, isIntersecting);
      });
    };
    report(true);

    act(() => {
      current().scrollToKey(KEYS[30] ?? "");
    });
    report(false);

    expect(current().items).toHaveLength(0);
  });

  it("keeps pinned keys mounted outside the window", () => {
    const pinned = KEYS[KEYS.length - 1] ?? "";
    const { current } = renderHarness({ pinnedKeys: new Set([pinned]) });
    const indexes = current().items.map((item) => item.index);
    expect(indexes).toContain(KEYS.length - 1);
    // The pin rides along with, not instead of, the viewport window.
    expect(indexes).toContain(0);
  });

  it("maps keys to indexes and rejects unknown keys", () => {
    const { current } = renderHarness();
    expect(current().indexOfKey(KEYS[7] ?? "")).toBe(7);
    expect(current().indexOfKey("missing#c0")).toBe(-1);
    expect(current().scrollToKey("missing#c0")).toBe(false);
  });

  it("latches items and refuses scrolls while a hidden ancestor hides it", async () => {
    const { current } = renderHarness();
    const before = current().items;
    const wrapper = screen.getByTestId("wrapper");

    await act(async () => {
      wrapper.setAttribute("hidden", "");
      // MutationObserver delivers on a microtask.
      await Promise.resolve();
    });

    expect(current().active).toBe(false);
    expect(current().items).toBe(before);
    expect(current().scrollToKey(KEYS[0] ?? "")).toBe(false);

    await act(async () => {
      wrapper.removeAttribute("hidden");
      await Promise.resolve();
    });
    expect(current().active).toBe(true);
  });

  it("leaves size changes to the browser where it anchors scrolling", () => {
    stubScrollAnchoring(true);
    const { current } = renderHarness();
    const first = readCompensation();

    act(() => {
      current().holdScrollCompensation(true);
      current().holdScrollCompensation(false);
    });

    expect(first).toBe(refuseScrollCompensation);
    expect(readCompensation()).toBe(refuseScrollCompensation);
  });

  it("keeps the library's rule where the browser cannot anchor", () => {
    stubScrollAnchoring(false);
    const { current } = renderHarness();

    act(() => {
      current().holdScrollCompensation(true);
    });
    const held = readCompensation();
    act(() => {
      current().holdScrollCompensation(false);
    });

    expect(held).toBe(refuseScrollCompensation);
    expect(readCompensation()).toBeUndefined();
  });
});
