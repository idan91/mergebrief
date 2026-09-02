// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useMergedRef } from "./useMergedRef";

describe("useMergedRef", () => {
  it("feeds a callback ref and an object ref the same node", () => {
    const callback = vi.fn();
    const object = createRef<HTMLDivElement>();
    const { result } = renderHook(() => useMergedRef(callback, object));
    const node = document.createElement("div");

    result.current(node);

    expect(callback).toHaveBeenCalledWith(node);
    expect(object.current).toBe(node);
  });

  it("skips a missing ref and keeps its identity while the inputs hold", () => {
    const callback = vi.fn();
    const { result, rerender } = renderHook(() =>
      useMergedRef<HTMLDivElement>(callback, undefined),
    );
    const first = result.current;

    rerender();
    result.current(null);

    expect(result.current).toBe(first);
    expect(callback).toHaveBeenCalledWith(null);
  });
});
