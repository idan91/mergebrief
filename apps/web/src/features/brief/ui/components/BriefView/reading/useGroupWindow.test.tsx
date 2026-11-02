// @vitest-environment jsdom
// jsdom has no layout, so these tests exercise the hook's own logic: window
// determinism off the fixed SSR rect, the pinned-index range, the
// hidden-pane latch, and the key→index contract. Real-geometry behavior
// (measured heights, scroll to target) belongs to the perf specs.
import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { intersectionObservers } from "@web/test/setup";
import { useGroupWindow, type GroupWindowOptions } from "./useGroupWindow";

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

describe("useGroupWindow", () => {
  it("renders a bounded window, not the whole list", () => {
    const { current } = renderHarness();
    const { items } = current();
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(KEYS.length);
    expect(current().totalSize).toBe(KEYS.length * 600);
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
});
