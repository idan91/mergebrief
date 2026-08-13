// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PENDING_APPEAR_MS,
  PENDING_MIN_HOLD_MS,
  useDelayedPending,
} from "./useDelayedPending";

describe("useDelayedPending", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows nothing for a load faster than the appearance delay", () => {
    const { result, rerender } = renderHook(
      ({ pending }: { pending: boolean }) => useDelayedPending(pending),
      { initialProps: { pending: true } },
    );
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(PENDING_APPEAR_MS - 1);
    });
    rerender({ pending: false });
    act(() => {
      vi.runAllTimers();
    });
    expect(result.current).toBe(false);
  });

  it("appears only after the delay while still pending", () => {
    const { result } = renderHook(() => useDelayedPending(true));
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(PENDING_APPEAR_MS);
    });
    expect(result.current).toBe(true);
  });

  it("holds for the minimum once shown, even if pending ends sooner", () => {
    const { result, rerender } = renderHook(
      ({ pending }: { pending: boolean }) => useDelayedPending(pending),
      { initialProps: { pending: true } },
    );
    act(() => {
      vi.advanceTimersByTime(PENDING_APPEAR_MS);
    });
    expect(result.current).toBe(true);

    // Pending resolves immediately after appearing — the indicator must not
    // flicker off before the hold elapses.
    rerender({ pending: false });
    act(() => {
      vi.advanceTimersByTime(PENDING_MIN_HOLD_MS - 1);
    });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(false);
  });

  it("hides immediately when pending ends after the hold already elapsed", () => {
    const { result, rerender } = renderHook(
      ({ pending }: { pending: boolean }) => useDelayedPending(pending),
      { initialProps: { pending: true } },
    );
    // Stepped advances (not one jump): the effect re-runs on the shown flip,
    // and a re-armed appear timer would overwrite the hold's origin — the
    // hold below must be measured from the FIRST appearance.
    act(() => {
      vi.advanceTimersByTime(PENDING_APPEAR_MS);
    });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(PENDING_MIN_HOLD_MS + 50);
    });
    expect(result.current).toBe(true);
    rerender({ pending: false });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toBe(false);
  });

  it("restarts the appearance delay for a new pending episode", () => {
    const { result, rerender } = renderHook(
      ({ pending }: { pending: boolean }) => useDelayedPending(pending),
      { initialProps: { pending: true } },
    );
    act(() => {
      vi.advanceTimersByTime(PENDING_APPEAR_MS);
    });
    rerender({ pending: false });
    act(() => {
      vi.runAllTimers();
    });
    expect(result.current).toBe(false);

    rerender({ pending: true });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(PENDING_APPEAR_MS - 1);
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);
  });
});
