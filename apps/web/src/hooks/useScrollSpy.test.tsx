// @vitest-environment jsdom
// The resetKey contract: positional ids (c1..cN) are char-identical across
// brief revisions, so the spy's effect key cannot rely on the id list alone —
// a brief switch replaces the DOM nodes while the ids stay the same, and
// without a resetKey the observer keeps its OLD answer latched and dedupes
// the new document's identical id away.
import { cleanup, renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useScrollSpy } from "./useScrollSpy";

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

function scrollTick(): void {
  act(() => {
    window.dispatchEvent(new Event("scroll"));
    // The spy coalesces scroll events through one rAF.
    vi.advanceTimersByTime(20);
  });
}

describe("useScrollSpy", () => {
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

  it("does not fire while nothing crosses the line", () => {
    const el = mountCrossing("c1");
    el.getBoundingClientRect = () => rectAt(900, 1000);
    const onActive = vi.fn();
    renderHook(() => useScrollSpy(["c1"], onActive));
    expect(onActive).not.toHaveBeenCalled();
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

    // New resetKey: re-initialise against the current document — the latch
    // clears, so when the SAME id crosses again it fires again (a stale
    // latch would dedupe it away).
    rerender({ resetKey: "brief-b" });
    expect(onActive.mock.calls).toEqual([["c1"]]);
    replacement.getBoundingClientRect = () => rectAt(100, 300);
    scrollTick();
    expect(onActive.mock.calls).toEqual([["c1"], ["c1"]]);
    vi.useRealTimers();
  });
});
