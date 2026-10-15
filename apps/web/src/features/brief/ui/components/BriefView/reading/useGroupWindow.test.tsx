// @vitest-environment jsdom
// jsdom has no layout, so these tests exercise the hook's own logic: window
// determinism off the fixed SSR rect, the pinned-index range, the
// hidden-pane latch, and the key→index contract. Real-geometry behavior
// (measured heights, scroll to target) belongs to the perf specs.
import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGroupWindow, type GroupWindowOptions } from "./useGroupWindow";

// jsdom implements scrollTo as a loud not-implemented warning; the
// virtualizer's internal scroll anchoring calls it on measurement changes.
beforeEach(() => {
  vi.stubGlobal("scrollTo", vi.fn());
});

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

  it("computes identical windows for identical inputs", () => {
    const first = renderHarness();
    const second = renderHarness();
    expect(first.current().items.map((item) => item.key)).toEqual(
      second.current().items.map((item) => item.key),
    );
    expect(first.current().totalSize).toBe(second.current().totalSize);
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
