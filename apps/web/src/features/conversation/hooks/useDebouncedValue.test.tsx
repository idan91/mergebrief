// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebouncedValue } from "./useDebouncedValue";

const DELAY_MS = 200;

describe("useDebouncedValue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("starts at the first value", () => {
    const { result } = renderHook(() => useDebouncedValue("a", DELAY_MS));
    expect(result.current).toBe("a");
  });

  it("follows a change only once the delay passes without another", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, DELAY_MS),
      { initialProps: { value: "a" } },
    );

    rerender({ value: "ab" });
    act(() => {
      vi.advanceTimersByTime(DELAY_MS - 1);
    });
    rerender({ value: "abc" });
    act(() => {
      vi.advanceTimersByTime(DELAY_MS - 1);
    });
    expect(result.current).toBe("a");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe("abc");
  });
});
