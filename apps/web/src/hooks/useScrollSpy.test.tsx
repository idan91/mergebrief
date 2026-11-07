// @vitest-environment jsdom
// The resetKey contract: positional ids (c1..cN) are char-identical across
// brief revisions, so the spy's effect key cannot rely on the id list alone:
// a brief switch replaces the DOM nodes while the ids stay the same, and
// without a resetKey the observer keeps its OLD answer latched and dedupes
// the new document's identical id away.
import { cleanup, renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useScrollSpy, type ScrollSpySync } from "./useScrollSpy";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

/** A real DOMRect spanning top→bottom (x/width irrelevant to the spy). */
function rectAt(top: number, bottom: number): DOMRect {
  return new DOMRect(0, top, 0, bottom - top);
}

/** A node `useScrollSpy` sees as crossing the reading line (top<=150<bottom). */
function mountCrossing(id: string): HTMLElement {
  const el = document.createElement("div");
  el.id = id;
  el.getBoundingClientRect = () => rectAt(100, 300);
  document.body.append(el);
  return el;
}

function makeSync(overrides: Partial<ScrollSpySync>): ScrollSpySync {
  return {
    readActive: () => undefined,
    isHeld: () => false,
    subscribeHoldEnded: () => () => {},
    isExact: () => false,
    clearActive: () => {},
    isAtPageEnd: () => false,
    ...overrides,
  };
}

function mountAt(id: string, top: number, bottom: number): void {
  const el = document.createElement("div");
  el.id = id;
  el.getBoundingClientRect = () => rectAt(top, bottom);
  document.body.append(el);
}

function scrollTick(): void {
  act(() => {
    window.dispatchEvent(new Event("scroll"));
    // The spy coalesces scroll events through one rAF.
    vi.advanceTimersByTime(20);
  });
}

describe("useScrollSpy", () => {
  it("reads a function reading line on every tick", () => {
    vi.useFakeTimers();
    const el = mountCrossing("c1");
    el.getBoundingClientRect = () => rectAt(200, 400);
    const line = { at: 150 };
    const onActive = vi.fn();
    renderHook(() => useScrollSpy(["c1"], onActive, () => line.at));
    expect(onActive).not.toHaveBeenCalled();

    line.at = 250;
    scrollTick();
    expect(onActive.mock.calls).toEqual([["c1"]]);
    vi.useRealTimers();
  });

  it("reports the crossing id once and dedupes repeats", () => {
    vi.useFakeTimers();
    mountCrossing("c1");
    const onActive = vi.fn();
    renderHook(() => useScrollSpy(["c1"], onActive));
    expect(onActive.mock.calls).toEqual([["c1"]]);

    scrollTick();
    expect(onActive.mock.calls).toEqual([["c1"]]);
    vi.useRealTimers();
  });

  it("re-initialises when resetKey changes even though ids are identical", () => {
    vi.useFakeTimers();
    const el = mountCrossing("c1");
    const onActive = vi.fn();
    const { rerender } = renderHook(
      ({ resetKey }: { resetKey: string }) =>
        useScrollSpy(["c1"], onActive, undefined, resetKey),
      { initialProps: { resetKey: "brief-a" } },
    );
    expect(onActive.mock.calls).toEqual([["c1"]]);

    // The brief switch: same id, new node, no longer crossing the line.
    el.remove();
    const replacement = document.createElement("div");
    replacement.id = "c1";
    replacement.getBoundingClientRect = () => rectAt(900, 1000);
    document.body.append(replacement);

    // Identical id list, unchanged resetKey: the effect must NOT re-run.
    rerender({ resetKey: "brief-a" });
    expect(onActive.mock.calls).toEqual([["c1"]]);

    // New resetKey: re-initialise against the current document; the latch
    // clears, so when the SAME id crosses again it fires again (a stale
    // latch would dedupe it away).
    rerender({ resetKey: "brief-b" });
    expect(onActive.mock.calls).toEqual([["c1"]]);
    replacement.getBoundingClientRect = () => rectAt(100, 300);
    scrollTick();
    expect(onActive.mock.calls).toEqual([["c1"], ["c1"]]);
    vi.useRealTimers();
  });

  it("corrects an explicit write once a scroll lands off its chunk", () => {
    vi.useFakeTimers();
    mountCrossing("a");
    let active: string | undefined;
    const onActive = vi.fn((id: string) => {
      active = id;
    });
    const sync = makeSync({ readActive: () => active });
    renderHook(() => useScrollSpy(["a"], onActive, 150, "", sync));
    expect(onActive.mock.calls).toEqual([["a"]]);

    active = "b";
    scrollTick();

    expect(onActive.mock.calls).toEqual([["a"], ["a"]]);
    expect(active).toBe("a");
    vi.useRealTimers();
  });

  it("writes nothing while a jump is flying, then corrects after", () => {
    vi.useFakeTimers();
    mountCrossing("a");
    let active: string | undefined = "b";
    let held = true;
    const onActive = vi.fn((id: string) => {
      active = id;
    });
    const sync = makeSync({
      readActive: () => active,
      isHeld: () => held,
    });
    renderHook(() => useScrollSpy(["a"], onActive, 150, "", sync));

    scrollTick();
    expect(onActive).not.toHaveBeenCalled();

    held = false;
    scrollTick();
    expect(onActive.mock.calls).toEqual([["a"]]);
    vi.useRealTimers();
  });

  it("repeats nothing when the store already names the chunk", () => {
    vi.useFakeTimers();
    mountCrossing("a");
    const onActive = vi.fn();
    const sync = makeSync({ readActive: () => "a" });
    renderHook(() => useScrollSpy(["a"], onActive, 150, "", sync));

    scrollTick();

    expect(onActive).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("re-reads when a jump ends with no scroll to follow", () => {
    vi.useFakeTimers();
    mountCrossing("a");
    let held = true;
    let endHold = () => {};
    const onActive = vi.fn();
    const sync = makeSync({
      readActive: () => "b",
      isHeld: () => held,
      subscribeHoldEnded: (listener) => {
        endHold = listener;
        return () => {};
      },
    });
    renderHook(() => useScrollSpy(["a"], onActive, 150, "", sync));
    expect(onActive).not.toHaveBeenCalled();

    held = false;
    act(() => {
      endHold();
      vi.advanceTimersByTime(20);
    });

    expect(onActive.mock.calls).toEqual([["a"]]);
    vi.useRealTimers();
  });

  it("names the next element down when an exact line crosses none", () => {
    mountAt("a", -300, 40);
    mountAt("b", 100, 300);
    const onActive = vi.fn();
    const sync = makeSync({ readActive: () => "a", isExact: () => true });

    renderHook(() => useScrollSpy(["a", "b"], onActive, 50, "", sync));

    expect(onActive.mock.calls).toEqual([["b"]]);
  });

  it("clears an exact answer when the next element is below the fold", () => {
    mountAt("a", -300, 40);
    mountAt("b", window.innerHeight + 10, window.innerHeight + 300);
    const onActive = vi.fn();
    const clearActive = vi.fn();
    const sync = makeSync({
      readActive: () => "a",
      isExact: () => true,
      clearActive,
    });

    renderHook(() => useScrollSpy(["a", "b"], onActive, 50, "", sync));

    expect(onActive).not.toHaveBeenCalled();
    expect(clearActive).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("reports the last answer below the line when scrolled up out of it", () => {
    mountAt("a", -600, -400);
    mountAt("b", window.innerHeight + 10, window.innerHeight + 300);
    const onActive = vi.fn();
    const clearActive = vi.fn();
    const sync = makeSync({
      readActive: () => "b",
      isExact: () => true,
      clearActive,
    });

    renderHook(() => useScrollSpy(["a", "b"], onActive, 50, "", sync));

    expect(onActive).not.toHaveBeenCalled();
    expect(clearActive).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("keeps the last answer between elements when the line is not exact", () => {
    mountAt("a", -300, 40);
    mountAt("b", 100, 300);
    const onActive = vi.fn();
    const sync = makeSync({ readActive: () => "a" });

    renderHook(() => useScrollSpy(["a", "b"], onActive, 50, "", sync));

    expect(onActive).not.toHaveBeenCalled();
  });

  it("re-reads an exact answer when the layout shifts with no scroll", () => {
    vi.useFakeTimers();
    let shiftLayout = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          shiftLayout = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const card = mountCrossing("a");
    mountAt("b", 400, 500);
    let active: string | undefined = "a";
    const onActive = vi.fn((id: string) => {
      active = id;
    });
    const sync = makeSync({
      readActive: () => active,
      isExact: () => true,
    });
    renderHook(() => useScrollSpy(["a", "b"], onActive, 150, "", sync));

    card.getBoundingClientRect = () => rectAt(-200, 0);
    act(() => {
      shiftLayout();
      vi.advanceTimersByTime(20);
    });

    expect(active).toBe("b");
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("at the page end", () => {
    function endJumpToShortLastChunk(exact: boolean) {
      mountCrossing("next-to-last");
      mountAt("last", 400, 500);
      let active: string | undefined = "last";
      let held = true;
      let atEnd = true;
      let endHold = () => {};
      const onActive = vi.fn((id: string) => {
        active = id;
      });
      const sync = makeSync({
        readActive: () => active,
        isHeld: () => held,
        isExact: () => exact,
        isAtPageEnd: () => atEnd,
        subscribeHoldEnded: (listener) => {
          endHold = listener;
          return () => {};
        },
      });
      renderHook(() =>
        useScrollSpy(["next-to-last", "last"], onActive, 150, "", sync),
      );
      held = false;
      act(() => {
        endHold();
        vi.advanceTimersByTime(20);
      });
      return {
        readActive: () => active,
        scrollUp: () => {
          atEnd = false;
          scrollTick();
        },
      };
    }

    it.each([
      ["a crossing line", false],
      ["an exact line", true],
    ])("keeps a short last chunk a jump named on %s", (_line, exact) => {
      vi.useFakeTimers();
      const page = endJumpToShortLastChunk(exact);

      expect(page.readActive()).toBe("last");
      vi.useRealTimers();
    });

    it.each([
      ["a crossing line", false],
      ["an exact line", true],
    ])("corrects again once scrolled up from the end on %s", (_line, exact) => {
      vi.useFakeTimers();
      const page = endJumpToShortLastChunk(exact);

      page.scrollUp();

      expect(page.readActive()).toBe("next-to-last");
      vi.useRealTimers();
    });

    it("corrects a stored chunk above the line to a last chunk crossing it", () => {
      mountAt("next-to-last", -300, 100);
      mountCrossing("last");
      const onActive = vi.fn();
      const sync = makeSync({
        readActive: () => "next-to-last",
        isAtPageEnd: () => true,
      });

      renderHook(() =>
        useScrollSpy(["next-to-last", "last"], onActive, 150, "", sync),
      );

      expect(onActive.mock.calls).toEqual([["last"]]);
    });
  });
});
