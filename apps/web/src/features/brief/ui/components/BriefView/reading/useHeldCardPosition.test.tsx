// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createChunkWindowRegistry,
  type ChunkWindowRegistry,
} from "./chunk-windows";
import { HOLD_FRAMES, useHeldCardPosition } from "./useHeldCardPosition";

interface HarnessProps {
  codePending: boolean;
  windows?: ChunkWindowRegistry | null;
}

function Harness({ codePending, windows = null }: HarnessProps) {
  useHeldCardPosition(codePending, windows);
  return null;
}

function stubWindows(): ChunkWindowRegistry & { held: boolean[] } {
  const held: boolean[] = [];
  const registry = createChunkWindowRegistry();
  registry.register({
    scrollToChunk: () => false,
    holdScrollCompensation: (next) => {
      held.push(next);
    },
  });
  return Object.assign(registry, { held });
}

function mountCard(
  top: number,
  height = 300,
): {
  card: HTMLElement;
  moveTo: (next: number) => void;
} {
  const card = document.createElement("div");
  card.setAttribute("data-index", "0");
  document.body.append(card);
  let currentTop = top;
  card.getBoundingClientRect = () =>
    ({ top: currentTop, bottom: currentTop + height }) as DOMRect;
  return {
    card,
    moveTo: (next) => {
      currentTop = next;
    },
  };
}

const scrollBy = vi.fn();
let frames: FrameRequestCallback[] = [];
let layoutObservers: { notify: () => void; watching: boolean }[] = [];

class RecordingResizeObserver implements ResizeObserver {
  private readonly record: { notify: () => void; watching: boolean };

  constructor(callback: ResizeObserverCallback) {
    this.record = {
      notify: () => callback([], this),
      watching: false,
    };
    layoutObservers.push(this.record);
  }

  observe(): void {
    this.record.watching = true;
  }

  unobserve(): void {}

  disconnect(): void {
    this.record.watching = false;
  }
}

function notifyLayoutObservers(): void {
  for (const observer of layoutObservers) {
    if (observer.watching) {
      observer.notify();
    }
  }
}

function flushFrames(count: number): void {
  for (let step = 0; step < count; step += 1) {
    const pending = frames;
    frames = [];
    for (const callback of pending) {
      callback(performance.now());
    }
  }
}

beforeEach(() => {
  frames = [];
  layoutObservers = [];
  vi.stubGlobal("ResizeObserver", RecordingResizeObserver);
  vi.stubGlobal("scrollBy", scrollBy);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => frames.push(callback)),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  scrollBy.mockClear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  document.documentElement.style.removeProperty("--sticky-stack-h");
  vi.unstubAllGlobals();
});

describe("useHeldCardPosition", () => {
  it("scrolls by the on-screen card's drift when the code lands", () => {
    const { moveTo } = mountCard(120);
    const view = render(<Harness codePending={true} />);

    moveTo(420);
    act(() => {
      view.rerender(<Harness codePending={false} />);
    });

    expect(scrollBy).toHaveBeenCalledWith({ top: 300, behavior: "instant" });
  });

  it("holds the card below a straddling card that grows when code lands", () => {
    document.documentElement.style.setProperty("--sticky-stack-h", "110px");
    mountCard(-800, 1000);
    const next = mountCard(200);
    const view = render(<Harness codePending={true} />);

    next.moveTo(444);
    act(() => {
      view.rerender(<Harness codePending={false} />);
    });

    expect(scrollBy).toHaveBeenCalledWith({ top: 244, behavior: "instant" });
  });

  it("re-reads the anchor on scroll while the code is pending", () => {
    const { moveTo } = mountCard(120);
    const view = render(<Harness codePending={true} />);

    moveTo(60);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    moveTo(100);
    act(() => {
      view.rerender(<Harness codePending={false} />);
    });

    expect(scrollBy).toHaveBeenCalledWith({ top: 40, behavior: "instant" });
  });

  it("re-reads the anchor on a layout shift that scrolls nothing", () => {
    const { moveTo } = mountCard(120);
    const view = render(<Harness codePending={true} />);

    moveTo(180);
    act(() => {
      notifyLayoutObservers();
    });
    moveTo(480);
    act(() => {
      view.rerender(<Harness codePending={false} />);
    });

    expect(scrollBy).toHaveBeenCalledWith({ top: 300, behavior: "instant" });
  });

  it("stops watching the layout once the code lands", () => {
    mountCard(120);
    const view = render(<Harness codePending={true} />);

    act(() => {
      view.rerender(<Harness codePending={false} />);
    });

    expect(layoutObservers.length).toBeGreaterThan(0);
    expect(layoutObservers.some((observer) => observer.watching)).toBe(false);
  });

  it("leaves a jump alone that moved the page before its scroll event", () => {
    const { moveTo } = mountCard(120);
    const view = render(<Harness codePending={true} />);

    vi.stubGlobal("scrollY", 7350);
    moveTo(-7230);
    act(() => {
      view.rerender(<Harness codePending={false} />);
    });

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("keeps an instant jump made in the frame of one of its corrections", () => {
    const { moveTo } = mountCard(120);
    const view = render(<Harness codePending={true} />);

    moveTo(420);
    act(() => {
      view.rerender(<Harness codePending={false} />);
    });
    expect(scrollBy).toHaveBeenCalledWith({ top: 300, behavior: "instant" });
    moveTo(120);
    vi.stubGlobal("scrollY", 5300);
    moveTo(-5000);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      flushFrames(1);
    });

    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it("keeps a jump whose scroll event has not fired by the next frame", () => {
    const { moveTo } = mountCard(120);
    const view = render(<Harness codePending={true} />);

    moveTo(420);
    act(() => {
      view.rerender(<Harness codePending={false} />);
    });
    moveTo(120);
    vi.stubGlobal("scrollY", 5300);
    moveTo(-5000);
    act(() => {
      flushFrames(1);
    });

    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it("leaves the page alone when the card did not move", () => {
    mountCard(120);
    const view = render(<Harness codePending={true} />);

    act(() => {
      view.rerender(<Harness codePending={false} />);
    });

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("holds the windows' compensation through the landing and releases it", () => {
    const { moveTo } = mountCard(120);
    const windows = stubWindows();
    const view = render(<Harness codePending={true} windows={windows} />);

    moveTo(200);
    act(() => {
      view.rerender(<Harness codePending={false} windows={windows} />);
    });
    expect(windows.held).toEqual([true]);
    expect(scrollBy).toHaveBeenCalledWith({ top: 80, behavior: "instant" });

    act(() => {
      view.unmount();
    });
    expect(windows.held).toEqual([true, false]);
  });

  it("keeps the hold through a re-render after the landing", () => {
    const { moveTo } = mountCard(120);
    const windows = stubWindows();
    const view = render(<Harness codePending={true} windows={windows} />);

    moveTo(200);
    act(() => {
      view.rerender(<Harness codePending={false} windows={windows} />);
    });
    act(() => {
      view.rerender(<Harness codePending={false} windows={windows} />);
    });

    expect(windows.held).toEqual([true]);
  });

  it("re-arms the hold for a second landing after the first ran out", () => {
    const { moveTo } = mountCard(120);
    const windows = stubWindows();
    const view = render(<Harness codePending={true} windows={windows} />);

    moveTo(200);
    act(() => {
      view.rerender(<Harness codePending={false} windows={windows} />);
    });
    act(() => {
      flushFrames(HOLD_FRAMES);
    });
    expect(windows.held).toEqual([true, false]);

    act(() => {
      view.rerender(<Harness codePending={true} windows={windows} />);
    });
    moveTo(260);
    act(() => {
      view.rerender(<Harness codePending={false} windows={windows} />);
    });

    expect(windows.held).toEqual([true, false, true]);
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 60, behavior: "instant" });
  });

  it("replaces a live hold on a second landing and keeps the windows held", () => {
    const { moveTo } = mountCard(120);
    const windows = stubWindows();
    const view = render(<Harness codePending={true} windows={windows} />);

    moveTo(200);
    act(() => {
      view.rerender(<Harness codePending={false} windows={windows} />);
    });
    act(() => {
      view.rerender(<Harness codePending={true} windows={windows} />);
    });
    act(() => {
      view.rerender(<Harness codePending={false} windows={windows} />);
    });

    expect(windows.held).toEqual([true]);
  });

  it("releases the windows at once when no card is on screen", () => {
    const windows = stubWindows();
    const view = render(<Harness codePending={true} windows={windows} />);

    act(() => {
      view.rerender(<Harness codePending={false} windows={windows} />);
    });

    expect(windows.held).toEqual([true, false]);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("leaves a smooth scroll running when the code lands mid-scroll", () => {
    const { moveTo } = mountCard(120);
    const windows = stubWindows();
    const endSmoothScroll = windows.beginSmoothScroll();
    const view = render(<Harness codePending={true} windows={windows} />);

    moveTo(200);
    act(() => {
      view.rerender(<Harness codePending={false} windows={windows} />);
    });

    expect(scrollBy).not.toHaveBeenCalled();
    expect(windows.held).toEqual([true, false]);
    endSmoothScroll();
  });

  it("keeps another holder's compensation hold when its own hold ends", () => {
    const { moveTo } = mountCard(120);
    const windows = stubWindows();
    const releaseOther = windows.holdScrollCompensation();
    const view = render(<Harness codePending={true} windows={windows} />);

    moveTo(200);
    act(() => {
      view.rerender(<Harness codePending={false} windows={windows} />);
    });
    act(() => {
      flushFrames(HOLD_FRAMES);
    });
    expect(windows.held).toEqual([true]);

    releaseOther();
    expect(windows.held).toEqual([true, false]);
  });

  it("does nothing on a render that is not the landing", () => {
    const { moveTo } = mountCard(120);
    const view = render(<Harness codePending={false} />);

    moveTo(500);
    act(() => {
      view.rerender(<Harness codePending={false} />);
    });

    expect(scrollBy).not.toHaveBeenCalled();
  });
});
