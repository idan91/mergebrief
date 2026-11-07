// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import type { PointerEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CALLOUT_HOVER_DELAY_MS, CALLOUT_WARM_MS } from "./consts";
import { useCalloutHover } from "./useCalloutHover";
import { holdCalloutsWarm } from "./utils";

afterEach(() => {
  vi.useRealTimers();
});

function makePointer(pointerType: string): PointerEvent {
  return { pointerType } as unknown as PointerEvent;
}

describe("useCalloutHover", () => {
  it("opens once a mouse has rested for the delay, not before", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCalloutHover());

    act(() => result.current.arm(makePointer("mouse")));
    expect(result.current.open).toBe(false);
    act(() => {
      vi.advanceTimersByTime(CALLOUT_HOVER_DELAY_MS);
    });

    expect(result.current.open).toBe(true);
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
  });

  it("a leave before the delay, or a touch, opens nothing", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCalloutHover());

    act(() => result.current.arm(makePointer("mouse")));
    act(() => result.current.disarm());
    act(() => result.current.arm(makePointer("touch")));
    act(() => {
      vi.advanceTimersByTime(CALLOUT_HOVER_DELAY_MS);
    });

    expect(result.current.open).toBe(false);
  });

  it("a close under a resting pointer is not undone by the rest", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCalloutHover());

    act(() => result.current.arm(makePointer("mouse")));
    act(() => result.current.show());
    act(() => result.current.close());
    act(() => {
      vi.advanceTimersByTime(CALLOUT_HOVER_DELAY_MS);
    });

    expect(result.current.open).toBe(false);
  });

  it("unmounting under a resting pointer clears the timer", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useCalloutHover());

    act(() => result.current.arm(makePointer("mouse")));
    expect(vi.getTimerCount()).toBe(1);
    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("skips the delay while a callout is on screen or just left", () => {
    vi.useFakeTimers();
    const release = holdCalloutsWarm();
    const { result } = renderHook(() => useCalloutHover());

    act(() => result.current.arm(makePointer("mouse")));
    expect(result.current.open).toBe(true);

    act(() => result.current.close());
    release();
    act(() => result.current.arm(makePointer("mouse")));
    expect(result.current.open).toBe(true);

    act(() => result.current.close());
    vi.advanceTimersByTime(CALLOUT_WARM_MS);
    act(() => result.current.arm(makePointer("mouse")));
    expect(result.current.open).toBe(false);
  });
});
