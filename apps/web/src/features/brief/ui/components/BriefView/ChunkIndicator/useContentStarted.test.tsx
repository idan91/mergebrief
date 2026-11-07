// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONTENT_START_ATTR } from "../utils";
import { useContentStarted } from "./useContentStarted";

function mountSentinel(): HTMLElement {
  const sentinel = document.createElement("div");
  sentinel.setAttribute(CONTENT_START_ATTR, "");
  document.body.append(sentinel);
  return sentinel;
}

const VIEWPORT_HEIGHT = 700;
const SHORT_PAGE_HEIGHT = 1000;

function layOutShortPage(scrollY: number): void {
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    value: SHORT_PAGE_HEIGHT,
  });
  vi.stubGlobal("innerHeight", VIEWPORT_HEIGHT);
  vi.stubGlobal("scrollY", scrollY);
}

function countScrollListeners(calls: readonly (readonly unknown[])[]): number {
  return calls.filter((call) => call[0] === "scroll").length;
}

describe("useContentStarted", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document.documentElement, "scrollHeight");
    document.body.replaceChildren();
  });

  it("listens to no scroll off a phone", () => {
    mountSentinel();
    const addListener = vi.spyOn(window, "addEventListener");

    const { result } = renderHook(() => useContentStarted(false));

    expect(countScrollListeners(addListener.mock.calls)).toBe(0);
    expect(result.current.started).toBe(false);
  });

  it("starts listening once the viewport turns into a phone", () => {
    mountSentinel();
    const addListener = vi.spyOn(window, "addEventListener");
    const removeListener = vi.spyOn(window, "removeEventListener");

    const { rerender } = renderHook(({ phone }) => useContentStarted(phone), {
      initialProps: { phone: false },
    });
    rerender({ phone: true });
    expect(countScrollListeners(addListener.mock.calls)).toBe(1);

    rerender({ phone: false });
    expect(countScrollListeners(removeListener.mock.calls)).toBe(1);
  });

  it("reads past the content start on a phone", () => {
    const sentinel = mountSentinel();
    vi.spyOn(sentinel, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, -10, 0, 0),
    );

    const { result } = renderHook(() => useContentStarted(true));

    expect(result.current.started).toBe(true);
  });

  it("counts a short page scrolled to its end as started", () => {
    mountSentinel().getBoundingClientRect = () => new DOMRect(0, 200, 0, 0);
    layOutShortPage(0);
    const { result } = renderHook(() => useContentStarted(true));
    expect(result.current.started).toBe(false);

    layOutShortPage(SHORT_PAGE_HEIGHT - VIEWPORT_HEIGHT);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    expect(result.current.started).toBe(true);
  });

  it("counts a jump as started only on a page too short to scroll", () => {
    mountSentinel().getBoundingClientRect = () => new DOMRect(0, 200, 0, 0);
    layOutShortPage(0);
    const { result } = renderHook(() => useContentStarted(true));

    act(() => result.current.markJumped());
    expect(result.current.started).toBe(false);

    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: VIEWPORT_HEIGHT,
    });
    act(() => result.current.markJumped());
    expect(result.current.started).toBe(true);
  });
});
