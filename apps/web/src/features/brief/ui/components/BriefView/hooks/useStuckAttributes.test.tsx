// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStuckAttributes } from "./useStuckAttributes";

const STICKY_TOP_PX = 100;
const RAISED_TOP_PX = 150;
const RESTING_TOP_PX = 300;
const HEAD_HEIGHT_PX = 40;

interface StubEntry {
  target: Element;
  isIntersecting: boolean;
  boundingClientRect: { top: number; height: number };
  rootBounds: { top: number };
}

interface StubObserver {
  notify: (entries: StubEntry[]) => void;
  rootMargin: string;
  targets: Set<Element>;
  disconnected: boolean;
}

const observers: StubObserver[] = [];
const probeRenders = { count: 0 };
const pendingFrames = new Map<number, FrameRequestCallback>();
let lastFrameId = 0;

function stubRequestFrame(callback: FrameRequestCallback): number {
  lastFrameId += 1;
  pendingFrames.set(lastFrameId, callback);
  return lastFrameId;
}

function stubCancelFrame(id: number): void {
  pendingFrames.delete(id);
}

function runFrame(): void {
  const due = [...pendingFrames.values()];
  pendingFrames.clear();
  act(() => {
    for (const callback of due) {
      callback(0);
    }
  });
}

function hasMotion(name: string): boolean {
  return screen.getByTestId(name).getAttribute("data-motion") === "on";
}

class StubIntersectionObserver {
  private readonly record: StubObserver;

  constructor(
    notify: (entries: StubEntry[]) => void,
    init?: { rootMargin?: string },
  ) {
    this.record = {
      notify,
      rootMargin: init?.rootMargin ?? "",
      targets: new Set(),
      disconnected: false,
    };
    observers.push(this.record);
  }

  observe(target: Element): void {
    this.record.targets.add(target);
  }

  unobserve(target: Element): void {
    this.record.targets.delete(target);
  }

  disconnect(): void {
    this.record.disconnected = true;
    this.record.targets.clear();
  }
}

interface ProbeProps {
  name: string;
  topPx?: number;
}

function Probe({ name, topPx = STICKY_TOP_PX }: ProbeProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useStuckAttributes(ref);
  probeRenders.count += 1;

  return (
    <div
      ref={ref}
      data-testid={name}
      style={{ position: "sticky", top: `${String(topPx)}px` }}
    />
  );
}

interface ProbesProps {
  names: readonly string[];
}

function Probes({ names }: ProbesProps) {
  return (
    <>
      {names.map((name) => (
        <Probe key={name} name={name} />
      ))}
    </>
  );
}

function findObserver(target: Element): StubObserver | undefined {
  return observers.find(
    (observer) => !observer.disconnected && observer.targets.has(target),
  );
}

function readWatchedLine(observer: StubObserver): number {
  return -Number.parseFloat(observer.rootMargin);
}

function placeAt(name: string, top: number, height = HEAD_HEIGHT_PX): void {
  const target = screen.getByTestId(name);
  const observer = findObserver(target);
  if (observer === undefined) {
    throw new Error(`${name} is not observed`);
  }
  const line = readWatchedLine(observer);
  act(() => {
    observer.notify([
      {
        target,
        isIntersecting: height > 0 && top + height > line,
        boundingClientRect: { top, height },
        rootBounds: { top: line },
      },
    ]);
  });
}

function isStuck(name: string): boolean {
  return screen.getByTestId(name).hasAttribute("data-stuck");
}

async function writeRootOffset(value: string): Promise<void> {
  await act(async () => {
    document.documentElement.style.setProperty("--top-bar-h", value);
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
  vi.stubGlobal("requestAnimationFrame", stubRequestFrame);
  vi.stubGlobal("cancelAnimationFrame", stubCancelFrame);
});

afterEach(() => {
  cleanup();
  observers.length = 0;
  pendingFrames.clear();
  probeRenders.count = 0;
  document.documentElement.style.removeProperty("--top-bar-h");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useStuckAttributes", () => {
  it("pins the element once it reaches its sticky top", () => {
    render(<Probe name="toolbar" />);

    placeAt("toolbar", STICKY_TOP_PX);

    expect(isStuck("toolbar")).toBe(true);
  });

  it("unpins the element once it scrolls back below its sticky top", () => {
    render(<Probe name="toolbar" />);
    placeAt("toolbar", STICKY_TOP_PX);

    placeAt("toolbar", RESTING_TOP_PX);

    expect(isStuck("toolbar")).toBe(false);
  });

  it("watches the line one pixel under the sticky top", () => {
    render(<Probe name="toolbar" />);

    const observer = findObserver(screen.getByTestId("toolbar"));

    expect(observer?.rootMargin.startsWith("-101px ")).toBe(true);
  });

  it("never pins an element the layout hides", () => {
    render(<Probe name="toolbar" />);

    placeAt("toolbar", 0, 0);

    expect(isStuck("toolbar")).toBe(false);
  });

  it("follows the sticky top when the pinned stack above it changes", async () => {
    render(<Probe name="toolbar" />);
    const target = screen.getByTestId("toolbar");
    const before = findObserver(target);

    target.style.top = `${String(RAISED_TOP_PX)}px`;
    await writeRootOffset(`${String(RAISED_TOP_PX)}px`);
    placeAt("toolbar", RAISED_TOP_PX);

    expect(before?.disconnected).toBe(true);
    expect(findObserver(target)?.rootMargin.startsWith("-151px ")).toBe(true);
    expect(isStuck("toolbar")).toBe(true);
  });

  it("follows the sticky top across a resize", () => {
    render(<Probe name="toolbar" />);
    const target = screen.getByTestId("toolbar");

    target.style.top = `${String(RAISED_TOP_PX)}px`;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(findObserver(target)?.rootMargin.startsWith("-151px ")).toBe(true);
  });

  it("drops the pin once the element stops being sticky", () => {
    render(<Probe name="head" />);
    const target = screen.getByTestId("head");
    placeAt("head", STICKY_TOP_PX);

    target.style.position = "static";
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(findObserver(target)).toBeUndefined();
    expect(isStuck("head")).toBe(false);
  });

  it("shares one observer across elements at one sticky top", () => {
    const names = ["head-1", "head-2", "head-3"];
    render(<Probes names={names} />);

    const shared = new Set(
      names.map((name) => findObserver(screen.getByTestId(name))),
    );
    placeAt("head-2", STICKY_TOP_PX);

    expect(shared.size).toBe(1);
    expect(names.map(isStuck)).toEqual([false, true, false]);
  });

  it("gives elements at different sticky tops their own observers", () => {
    render(
      <>
        <Probe name="toolbar" />
        <Probe name="head" topPx={RAISED_TOP_PX} />
      </>,
    );

    const toolbar = findObserver(screen.getByTestId("toolbar"));
    const head = findObserver(screen.getByTestId("head"));

    expect(toolbar).not.toBe(head);
  });

  it("stops observing a head that unmounts and keeps its siblings", () => {
    const { rerender } = render(<Probes names={["head-1", "head-2"]} />);
    const kept = screen.getByTestId("head-1");
    const removed = screen.getByTestId("head-2");
    const observer = findObserver(kept);

    rerender(<Probes names={["head-1"]} />);

    expect(observer?.targets.has(removed)).toBe(false);
    expect(observer?.targets.has(kept)).toBe(true);
    expect(observer?.disconnected).toBe(false);
  });

  it("disconnects everything once the last element unmounts", async () => {
    const { unmount } = render(<Probes names={["head-1", "head-2"]} />);
    const observer = findObserver(screen.getByTestId("head-1"));

    unmount();
    const created = observers.length;
    await writeRootOffset(`${String(RAISED_TOP_PX)}px`);

    expect(observer?.disconnected).toBe(true);
    expect(observers.length).toBe(created);
  });

  it("holds motion off until the element has first been read", () => {
    render(<Probe name="toolbar" />);

    runFrame();
    runFrame();

    expect(hasMotion("toolbar")).toBe(false);
  });

  it("paints a first pinned reading before it arms motion", () => {
    render(<Probe name="toolbar" />);

    placeAt("toolbar", STICKY_TOP_PX);
    runFrame();

    expect(isStuck("toolbar")).toBe(true);
    expect(hasMotion("toolbar")).toBe(false);
  });

  it("arms motion the frame after the first reading painted", () => {
    render(<Probe name="toolbar" />);
    placeAt("toolbar", RESTING_TOP_PX);

    runFrame();
    runFrame();

    expect(hasMotion("toolbar")).toBe(true);
  });

  it("disarms motion while the layout hides the element", () => {
    render(<Probe name="card" />);
    placeAt("card", RESTING_TOP_PX);
    runFrame();
    runFrame();

    placeAt("card", 0, 0);

    expect(hasMotion("card")).toBe(false);
  });

  it("paints an element shown again already pinned without motion", () => {
    render(<Probe name="card" />);
    placeAt("card", RESTING_TOP_PX);
    runFrame();
    runFrame();
    placeAt("card", 0, 0);

    placeAt("card", STICKY_TOP_PX);

    expect(isStuck("card")).toBe(true);
    expect(hasMotion("card")).toBe(false);
  });

  it("re-arms motion the frame after a shown-again reading painted", () => {
    render(<Probe name="card" />);
    placeAt("card", RESTING_TOP_PX);
    runFrame();
    runFrame();
    placeAt("card", 0, 0);
    placeAt("card", STICKY_TOP_PX);

    runFrame();
    runFrame();

    expect(hasMotion("card")).toBe(true);
  });

  it("disarms motion once the element scrolls past out of view", () => {
    render(<Probe name="card" />);
    placeAt("card", STICKY_TOP_PX);
    runFrame();
    runFrame();

    placeAt("card", STICKY_TOP_PX - 2 * HEAD_HEIGHT_PX);

    expect(hasMotion("card")).toBe(false);
  });

  it("paints a card scrolled past then shown resting without motion", () => {
    render(<Probe name="card" />);
    placeAt("card", STICKY_TOP_PX);
    runFrame();
    runFrame();
    placeAt("card", STICKY_TOP_PX - 2 * HEAD_HEIGHT_PX);

    placeAt("card", RESTING_TOP_PX);

    expect(isStuck("card")).toBe(false);
    expect(hasMotion("card")).toBe(false);
  });

  it("disarms motion when the element stops being sticky", () => {
    render(<Probe name="head" />);
    const target = screen.getByTestId("head");
    placeAt("head", STICKY_TOP_PX);
    runFrame();
    runFrame();

    target.style.position = "static";
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(hasMotion("head")).toBe(false);
  });

  it("pins and arms motion without re-rendering its caller", () => {
    render(<Probe name="card" />);
    const mounted = probeRenders.count;

    placeAt("card", STICKY_TOP_PX);
    runFrame();
    runFrame();
    placeAt("card", RESTING_TOP_PX);

    expect(hasMotion("card")).toBe(true);
    expect(probeRenders.count).toBe(mounted);
  });

  it("keeps a pinned element's mark while the layout hides it", () => {
    render(<Probe name="card" />);
    placeAt("card", STICKY_TOP_PX);

    placeAt("card", 0, 0);

    expect(isStuck("card")).toBe(true);
  });

  it("paints an element mounted at its sticky top pinned at once", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ y: STICKY_TOP_PX, height: HEAD_HEIGHT_PX }),
    );

    render(<Probe name="toolbar" />);

    expect(isStuck("toolbar")).toBe(true);
    expect(hasMotion("toolbar")).toBe(false);
  });

  it("drops the pending frame once the element unmounts", () => {
    const { unmount } = render(<Probe name="toolbar" />);
    placeAt("toolbar", STICKY_TOP_PX);

    unmount();

    expect(pendingFrames.size).toBe(0);
  });
});
