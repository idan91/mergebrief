// @vitest-environment jsdom
import { cleanup, render, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMergedRef } from "./useMergedRef";

afterEach(cleanup);

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

  it("forwards a callback ref's cleanup so an owned observer detaches", () => {
    const torn: string[] = [];
    const owning = (node: HTMLDivElement | null) => {
      if (node === null) {
        return undefined;
      }
      return () => {
        torn.push("cleanup");
      };
    };
    function Probe({ mounted }: { mounted: boolean }) {
      const ref = useMergedRef<HTMLDivElement>(owning, undefined);
      return mounted ? <div ref={ref} /> : null;
    }
    const view = render(<Probe mounted />);
    view.rerender(<Probe mounted={false} />);

    expect(torn).toEqual(["cleanup"]);
  });
});
