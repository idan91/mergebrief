// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deriveGroupHeadingId, deriveGroupSectionId } from "../utils";
import { useLanding } from ".";
import {
  LandHistories,
  LandMotions,
  LandPlacements,
  LandTargetKinds,
  type ChunkWindowsPort,
  type LandOptions,
} from "./types";

const nativeScrollBy = window.scrollBy;
const nativeScrollTo = window.scrollTo;

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--sticky-stack-h", "110px");
  window.scrollBy = vi.fn();
  window.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  document.documentElement.style.removeProperty("--sticky-stack-h");
  vi.useRealTimers();
  window.scrollBy = nativeScrollBy;
  window.scrollTo = nativeScrollTo;
});

const SMOOTH: LandOptions = {
  motion: LandMotions.SMOOTH,
  history: LandHistories.NONE,
};

function makeRect(top: number): DOMRect {
  return new DOMRect(0, top, 0, 300);
}

function mountCard(id: string, top: number): HTMLElement {
  const card = document.createElement("article");
  card.id = id;
  card.tabIndex = -1;
  card.getBoundingClientRect = () => makeRect(top);
  card.scrollIntoView = vi.fn();
  document.body.append(card);
  return card;
}

interface HostProps {
  briefId: string;
}

function renderLanding(
  chunkWindows?: ChunkWindowsPort,
  openChunk: (chunkId: string) => void = vi.fn(),
) {
  return renderHook(
    ({ briefId }: HostProps) =>
      useLanding({ briefId, chunkWindows, openChunk }),
    { initialProps: { briefId: "brief-a" } },
  );
}

describe("useLanding", () => {
  it("scrolls a near chunk into view once the jump is due", () => {
    const card = mountCard("chunk-a", 300);
    const { result } = renderLanding();

    let scheduled = false;
    act(() => {
      scheduled = result.current.land(
        { kind: LandTargetKinds.CHUNK, chunkId: "chunk-a" },
        SMOOTH,
      );
    });
    expect(scheduled).toBe(true);
    expect(card.scrollIntoView).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(card.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("aims an under-stack landing only after two frames", () => {
    mountCard("chunk-a", 300);
    const { result } = renderLanding();

    act(() => {
      result.current.land(
        { kind: LandTargetKinds.CHUNK, chunkId: "chunk-a" },
        { ...SMOOTH, placement: LandPlacements.UNDER_STACK },
      );
      vi.advanceTimersByTime(1);
    });
    expect(window.scrollTo).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(40);
    });
    expect(window.scrollTo).toHaveBeenCalledWith({
      behavior: "smooth",
      top: 150,
    });
  });

  it("opens the chunk's card before the jump when asked", () => {
    const openChunk = vi.fn();
    const { result } = renderLanding(undefined, openChunk);

    act(() => {
      result.current.land(
        { kind: LandTargetKinds.CHUNK, chunkId: "chunk-a" },
        { ...SMOOTH, open: true },
      );
    });

    expect(openChunk).toHaveBeenCalledWith("chunk-a");
  });

  it("focuses a group's heading without scrolling", () => {
    const section = document.createElement("section");
    section.id = deriveGroupSectionId("g1");
    section.getBoundingClientRect = () => makeRect(300);
    section.scrollIntoView = vi.fn();
    const heading = document.createElement("h2");
    heading.id = deriveGroupHeadingId("g1");
    heading.tabIndex = -1;
    const focus = vi.spyOn(heading, "focus");
    section.append(heading);
    document.body.append(section);
    const { result } = renderLanding();

    act(() => {
      result.current.land(
        { kind: LandTargetKinds.GROUP, groupId: "g1" },
        { ...SMOOTH, focus: true },
      );
    });

    expect(document.activeElement).toBe(heading);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("asks the windowed lists to bring an unmounted chunk near", () => {
    const chunkWindows = { scrollToChunk: vi.fn(() => true) };
    const { result } = renderLanding(chunkWindows);

    act(() => {
      result.current.land(
        { kind: LandTargetKinds.CHUNK, chunkId: "chunk-far" },
        SMOOTH,
      );
      vi.advanceTimersByTime(1);
    });

    expect(chunkWindows.scrollToChunk).toHaveBeenCalledWith("chunk-far");
  });

  it("nudges a far chunk onto its line once the scroll rests", () => {
    const card = mountCard("chunk-a", 9000);
    const { result } = renderLanding();

    act(() => {
      result.current.land(
        { kind: LandTargetKinds.CHUNK, chunkId: "chunk-a" },
        { ...SMOOTH, placement: LandPlacements.UNDER_STACK },
      );
      vi.advanceTimersByTime(200);
    });

    expect(card.scrollIntoView).toHaveBeenCalledWith({
      behavior: "instant",
      block: "start",
    });
    expect(window.scrollBy).toHaveBeenCalledTimes(1);
    expect(window.scrollBy).toHaveBeenCalledWith({
      behavior: "instant",
      top: 8850,
    });
  });

  it("re-places a landed chunk that a late reflow pushed away", () => {
    const card = mountCard("chunk-a", 9000);
    const { result } = renderLanding();

    act(() => {
      result.current.land(
        { kind: LandTargetKinds.CHUNK, chunkId: "chunk-a" },
        SMOOTH,
      );
      vi.advanceTimersByTime(200);
    });
    expect(window.scrollBy).toHaveBeenCalledTimes(1);

    card.getBoundingClientRect = () => makeRect(9600);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(window.scrollBy).toHaveBeenCalledTimes(2);
    expect(window.scrollBy).toHaveBeenLastCalledWith({
      behavior: "instant",
      top: 9600,
    });
  });

  it("stops correcting once the reader takes the scroll", () => {
    mountCard("chunk-a", 9000);
    const { result } = renderLanding();

    act(() => {
      result.current.land(
        { kind: LandTargetKinds.CHUNK, chunkId: "chunk-a" },
        SMOOTH,
      );
      vi.advanceTimersByTime(1);
      window.dispatchEvent(new Event("wheel"));
      vi.advanceTimersByTime(200);
    });

    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it("lets a second landing replace the first", () => {
    const first = mountCard("chunk-a", 300);
    const second = mountCard("chunk-b", 600);
    const { result } = renderLanding();

    act(() => {
      result.current.land(
        { kind: LandTargetKinds.CHUNK, chunkId: "chunk-a" },
        SMOOTH,
      );
      result.current.land(
        { kind: LandTargetKinds.CHUNK, chunkId: "chunk-b" },
        SMOOTH,
      );
      vi.advanceTimersByTime(1);
    });

    expect(first.scrollIntoView).not.toHaveBeenCalled();
    expect(second.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("drops a landing in flight when the brief changes", () => {
    const card = mountCard("chunk-a", 9000);
    const { result, rerender } = renderLanding();

    act(() => {
      result.current.land(
        { kind: LandTargetKinds.CHUNK, chunkId: "chunk-a" },
        SMOOTH,
      );
    });
    rerender({ briefId: "brief-b" });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(card.scrollIntoView).not.toHaveBeenCalled();
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a row target",
      {
        kind: LandTargetKinds.ROW,
        chunkId: "chunk-a",
        row: { side: "new", line: 3 },
      },
      SMOOTH,
    ],
    [
      "a rail target",
      { kind: LandTargetKinds.RAIL, chunkId: "chunk-a", railKey: "r1" },
      SMOOTH,
    ],
    [
      "a flash",
      { kind: LandTargetKinds.CHUNK, chunkId: "chunk-a" },
      { ...SMOOTH, flash: true },
    ],
    [
      "a history write",
      { kind: LandTargetKinds.CHUNK, chunkId: "chunk-a" },
      { ...SMOOTH, history: LandHistories.PUSH },
    ],
  ] as const)("refuses %s it cannot land yet", (_what, target, options) => {
    const card = mountCard("chunk-a", 300);
    const { result } = renderLanding();

    let scheduled = true;
    act(() => {
      scheduled = result.current.land(target, options);
      vi.advanceTimersByTime(200);
    });

    expect(scheduled).toBe(false);
    expect(card.scrollIntoView).not.toHaveBeenCalled();
  });
});
