// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SPLIT_MIN_WIDTH_PX, useSplitWidth } from "./useSplitWidth";

type ResizeCallback = (entries: { contentRect: { width: number } }[]) => void;

let observe: ResizeCallback | undefined;

class StubResizeObserver {
  constructor(callback: ResizeCallback) {
    observe = callback;
  }
  observe(): void {}
  disconnect(): void {}
}

function Probe({ withDiff = true }: { withDiff?: boolean }) {
  const splitWidth = useSplitWidth(true);
  if (!withDiff)
    return <output>{splitWidth.wideEnough ? "wide" : "narrow"}</output>;
  return (
    <div ref={splitWidth.attachWrapper}>
      <output>{splitWidth.wideEnough ? "wide" : "narrow"}</output>
    </div>
  );
}

afterEach(() => {
  cleanup();
  observe = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useSplitWidth", () => {
  it("reads wide before any measurement", () => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    render(<Probe />);

    expect(screen.getByRole("status").textContent).toBe("wide");
  });

  it("reads narrow once the wrapper measures under the minimum width", () => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    render(<Probe />);

    act(() => {
      observe?.([{ contentRect: { width: SPLIT_MIN_WIDTH_PX - 1 } }]);
      vi.runAllTimers();
    });

    expect(screen.getByRole("status").textContent).toBe("narrow");
  });

  it("reads wide at exactly the minimum width", () => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    render(<Probe />);

    act(() => {
      observe?.([{ contentRect: { width: SPLIT_MIN_WIDTH_PX } }]);
      vi.runAllTimers();
    });

    expect(screen.getByRole("status").textContent).toBe("wide");
  });

  it("ignores a hidden wrapper that measures zero", () => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    render(<Probe />);

    act(() => {
      observe?.([{ contentRect: { width: 0 } }]);
      vi.runAllTimers();
    });

    expect(screen.getByRole("status").textContent).toBe("wide");
  });

  it("arms once the wrapper attaches after a late diff", () => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    const view = render(<Probe withDiff={false} />);

    expect(observe).toBeUndefined();
    view.rerender(<Probe withDiff />);
    act(() => {
      observe?.([{ contentRect: { width: SPLIT_MIN_WIDTH_PX - 1 } }]);
      vi.runAllTimers();
    });

    expect(screen.getByRole("status").textContent).toBe("narrow");
  });
});
