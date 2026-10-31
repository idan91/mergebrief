// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import { REVISION_JUMP_ATTR } from "../../../../model/comparison/runs";
import type { ScopeExitOptions } from "../types";
import { deriveGroupHeadingId, deriveGroupSectionId } from "../utils";
import { createChunkWindowRegistry } from "../reading/chunk-windows";
import { useScrollToTarget } from ".";
import { FLASH_MS, SCROLL_FLASH_ATTR } from "./consts";
import { MOUNT_POLL_FRAMES } from "./engine/consts";
import { ScrollMotions, ScrollPlacements } from "./engine/types";
import {
  ScrollHistories,
  ScrollTargetKinds,
  type ChunkWindowsPort,
  type ScrollTargetOptions,
} from "./types";

const nativeScrollBy = window.scrollBy;
const nativeScrollTo = window.scrollTo;

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom has no CSS namespace; rail keys here need no escaping.
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  document.documentElement.style.setProperty("--sticky-stack-h", "110px");
  window.scrollBy = vi.fn();
  window.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  document.documentElement.style.removeProperty("--sticky-stack-h");
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.scrollBy = nativeScrollBy;
  window.scrollTo = nativeScrollTo;
});

function ignoreEnd(): void {}

const SMOOTH: ScrollTargetOptions = {
  motion: ScrollMotions.SMOOTH,
  history: ScrollHistories.NONE,
};
const PUSH: ScrollTargetOptions = { ...SMOOTH, history: ScrollHistories.PUSH };
const REPLACE: ScrollTargetOptions = {
  ...SMOOTH,
  history: ScrollHistories.REPLACE,
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

const FRAME_MS = 16;

const ROW_SCROLL: ScrollTargetOptions = {
  ...SMOOTH,
  open: true,
  focus: true,
  flash: true,
  placement: ScrollPlacements.READING_BAND,
};

const LINE_ROW = {
  kind: ScrollTargetKinds.ROW,
  chunkId: "chunk-a",
  row: { side: "new", line: 10 },
} as const;

function mountLineRow(card: HTMLElement): HTMLElement {
  card.innerHTML =
    '<table><tbody><tr data-line-kind="add"><td data-line-number=""></td>' +
    '<td data-line-number="" data-line-new="10">10</td><td>b</td></tr></tbody></table>';
  const row = card.querySelector("tr")!;
  row.getBoundingClientRect = () => makeRect(400);
  row.scrollIntoView = vi.fn();
  return row;
}

/** A browser ignores focus() on an element that is not rendered; jsdom does not. */
function stubFocusWhenRendered(
  element: HTMLElement,
  isRendered: () => boolean,
): void {
  const focus = element.focus.bind(element);
  element.focus = (options) => {
    if (isRendered()) {
      focus(options);
    }
  };
}

function mountRail(railKey: string): HTMLButtonElement {
  const rail = document.createElement("button");
  rail.setAttribute(REVISION_JUMP_ATTR, railKey);
  rail.getBoundingClientRect = () => makeRect(400);
  rail.scrollIntoView = vi.fn();
  document.body.append(rail);
  return rail;
}

interface HostProps {
  briefId: string;
  inChangesScope: boolean;
}

function renderScrollToTarget(
  chunkWindows?: ChunkWindowsPort,
  openChunk: (chunkId: string) => void = vi.fn(),
) {
  return renderHook(
    ({ briefId, inChangesScope }: HostProps) =>
      useScrollToTarget({
        briefId,
        chunkWindows,
        openChunk,
        inChangesScope,
        exitChangesScope: undefined,
      }),
    { initialProps: { briefId: "brief-a", inChangesScope: false } },
  );
}

/** Starts in Changes scope, where the story pane is not rendered. */
function renderChangesScroll(
  exitChangesScope: ((options: ScopeExitOptions) => void) | undefined,
) {
  return renderHook(
    ({ briefId, inChangesScope }: HostProps) =>
      useScrollToTarget({
        briefId,
        chunkWindows: undefined,
        openChunk: vi.fn(),
        inChangesScope,
        exitChangesScope,
      }),
    { initialProps: { briefId: "brief-a", inChangesScope: true } },
  );
}

const CHUNK_A = { kind: ScrollTargetKinds.CHUNK, chunkId: "chunk-a" } as const;

describe("useScrollToTarget", () => {
  it("scrolls a near chunk into view once the jump is due", () => {
    const card = mountCard("chunk-a", 300);
    const { result } = renderScrollToTarget();

    let scheduled = false;
    act(() => {
      scheduled = result.current.scrollToTarget(
        { kind: ScrollTargetKinds.CHUNK, chunkId: "chunk-a" },
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

  it("aims an under-stack scroll only after two frames", () => {
    mountCard("chunk-a", 300);
    const { result } = renderScrollToTarget();

    act(() => {
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.CHUNK, chunkId: "chunk-a" },
        { ...SMOOTH, placement: ScrollPlacements.UNDER_STACK },
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
    const { result } = renderScrollToTarget(undefined, openChunk);

    act(() => {
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.CHUNK, chunkId: "chunk-a" },
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
    const { result } = renderScrollToTarget();

    act(() => {
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.GROUP, groupId: "g1" },
        { ...SMOOTH, focus: true },
      );
      vi.advanceTimersByTime(1);
    });

    expect(document.activeElement).toBe(heading);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("marks a smooth scroll in flight until the scroll is dropped", () => {
    mountCard("chunk-a", 900);
    const registry = createChunkWindowRegistry();
    const { result, rerender } = renderScrollToTarget(registry);

    act(() => {
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.CHUNK, chunkId: "chunk-a" },
        SMOOTH,
      );
    });
    expect(registry.isSmoothScrolling()).toBe(true);

    rerender({ briefId: "brief-b", inChangesScope: false });
    expect(registry.isSmoothScrolling()).toBe(false);
  });

  it("marks no smooth scroll for an instant jump", () => {
    mountCard("chunk-a", 900);
    const registry = createChunkWindowRegistry();
    const { result } = renderScrollToTarget(registry);

    act(() => {
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.CHUNK, chunkId: "chunk-a" },
        { ...SMOOTH, motion: ScrollMotions.INSTANT },
      );
    });

    expect(registry.isSmoothScrolling()).toBe(false);
  });

  it("asks the windowed lists to bring an unmounted chunk near", () => {
    const chunkWindows = {
      scrollToChunk: vi.fn(() => true),
      beginSmoothScroll: () => ignoreEnd,
    };
    const { result } = renderScrollToTarget(chunkWindows);

    act(() => {
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.CHUNK, chunkId: "chunk-far" },
        SMOOTH,
      );
      vi.advanceTimersByTime(1);
    });

    expect(chunkWindows.scrollToChunk).toHaveBeenCalledWith("chunk-far");
  });

  it("nudges a far chunk onto its line once the scroll rests", () => {
    const card = mountCard("chunk-a", 9000);
    const { result } = renderScrollToTarget();

    act(() => {
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.CHUNK, chunkId: "chunk-a" },
        { ...SMOOTH, placement: ScrollPlacements.UNDER_STACK },
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

  it("re-places a placed chunk that a late reflow pushed away", () => {
    const card = mountCard("chunk-a", 9000);
    const { result } = renderScrollToTarget();

    act(() => {
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.CHUNK, chunkId: "chunk-a" },
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
    const { result } = renderScrollToTarget();

    act(() => {
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.CHUNK, chunkId: "chunk-a" },
        SMOOTH,
      );
      vi.advanceTimersByTime(1);
      window.dispatchEvent(new Event("wheel"));
      vi.advanceTimersByTime(200);
    });

    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it("stops re-placing once the reader presses a pointer in the card", () => {
    const card = mountCard("chunk-a", 9000);
    const inner = document.createElement("button");
    card.append(inner);
    inner.addEventListener("pointerdown", (event) => event.stopPropagation());
    const { result } = renderScrollToTarget();

    act(() => {
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.CHUNK, chunkId: "chunk-a" },
        { ...SMOOTH, focus: true },
      );
      vi.advanceTimersByTime(200);
    });
    expect(window.scrollBy).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(card);

    inner.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    card.getBoundingClientRect = () => makeRect(9600);
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(window.scrollBy).toHaveBeenCalledTimes(1);
  });

  it("lets a second scroll replace the first", () => {
    const first = mountCard("chunk-a", 300);
    const second = mountCard("chunk-b", 600);
    const { result } = renderScrollToTarget();

    act(() => {
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.CHUNK, chunkId: "chunk-a" },
        SMOOTH,
      );
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.CHUNK, chunkId: "chunk-b" },
        SMOOTH,
      );
      vi.advanceTimersByTime(1);
    });

    expect(first.scrollIntoView).not.toHaveBeenCalled();
    expect(second.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("drops a scroll in flight when the brief changes", () => {
    const card = mountCard("chunk-a", 9000);
    const { result, rerender } = renderScrollToTarget();

    act(() => {
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.CHUNK, chunkId: "chunk-a" },
        SMOOTH,
      );
    });
    rerender({ briefId: "brief-b", inChangesScope: false });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(card.scrollIntoView).not.toHaveBeenCalled();
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it("scrolls to a line's row, focuses it and flashes it", () => {
    const row = mountLineRow(mountCard("chunk-a", 300));
    const openChunk = vi.fn();
    const { result } = renderScrollToTarget(undefined, openChunk);

    act(() => {
      result.current.scrollToTarget(LINE_ROW, ROW_SCROLL);
    });
    expect(openChunk).toHaveBeenCalledWith("chunk-a");

    act(() => {
      vi.advanceTimersByTime(FRAME_MS * 2);
    });
    expect(document.activeElement).toBe(row);
    expect(row.getAttribute("tabindex")).toBe("-1");
    expect(row.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    expect(row.hasAttribute(SCROLL_FLASH_ATTR)).toBe(true);

    act(() => {
      vi.advanceTimersByTime(FLASH_MS);
    });
    expect(row.hasAttribute(SCROLL_FLASH_ATTR)).toBe(false);
  });

  it("focuses a thread row's disclosure, not the row", () => {
    const card = mountCard("chunk-a", 300);
    card.innerHTML =
      '<table><tbody><tr data-conversation-thread="7"><td><button>open</button></td></tr></tbody></table>';
    const { result } = renderScrollToTarget();

    act(() => {
      result.current.scrollToTarget(
        {
          kind: ScrollTargetKinds.ROW,
          chunkId: "chunk-a",
          row: { rowId: "chunk-a:0", threadId: 7 },
        },
        ROW_SCROLL,
      );
      vi.advanceTimersByTime(1);
    });

    expect(document.activeElement).toBe(card.querySelector("button"));
  });

  it("focuses a row whose card the same click reveals", () => {
    const card = mountCard("chunk-a", 300);
    const row = mountLineRow(card);
    stubFocusWhenRendered(row, () => card.hasAttribute("data-current"));
    const { result } = renderScrollToTarget();

    act(() => {
      result.current.scrollToTarget(LINE_ROW, ROW_SCROLL);
      card.setAttribute("data-current", "");
    });
    act(() => {
      vi.advanceTimersByTime(FRAME_MS * 2);
    });

    expect(document.activeElement).toBe(row);
  });

  it("concedes to the card when the row never renders", () => {
    const card = mountCard("chunk-a", 300);
    const { result } = renderScrollToTarget();

    act(() => {
      result.current.scrollToTarget(LINE_ROW, ROW_SCROLL);
      vi.advanceTimersByTime(FRAME_MS * (MOUNT_POLL_FRAMES + 4));
    });

    expect(document.activeElement).toBe(card);
    expect(card.hasAttribute(SCROLL_FLASH_ATTR)).toBe(true);
  });

  it("scrolls to a rail and focuses its button without scrolling", () => {
    const rail = mountRail("r1");
    const focus = vi.spyOn(rail, "focus");
    const { result } = renderScrollToTarget();

    act(() => {
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.RAIL, chunkId: "chunk-a", railKey: "r1" },
        { ...SMOOTH, focus: true, placement: ScrollPlacements.READING_BAND },
      );
      vi.advanceTimersByTime(1);
    });

    expect(document.activeElement).toBe(rail);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(rail.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
  });

  it("finds a mounted rail once, not on every watched frame", () => {
    mountRail("r1");
    const querySelectorAll = vi.spyOn(document, "querySelectorAll");
    const { result } = renderScrollToTarget();

    act(() => {
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.RAIL, chunkId: "chunk-a", railKey: "r1" },
        { ...SMOOTH, placement: ScrollPlacements.READING_BAND },
      );
      vi.advanceTimersByTime(FRAME_MS * 60);
    });

    expect(querySelectorAll).toHaveBeenCalledTimes(1);
  });

  it("finds the rail again when its node is replaced mid-watch", () => {
    const first = mountRail("r1");
    const { result } = renderScrollToTarget();

    act(() => {
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.RAIL, chunkId: "chunk-a", railKey: "r1" },
        { ...SMOOTH, placement: ScrollPlacements.READING_BAND },
      );
      vi.advanceTimersByTime(FRAME_MS * 30);
    });
    expect(window.scrollBy).not.toHaveBeenCalled();
    first.remove();
    const second = mountRail("r1");
    second.getBoundingClientRect = () => makeRect(20);
    act(() => {
      vi.advanceTimersByTime(FRAME_MS * 10);
    });

    expect(window.scrollBy).toHaveBeenCalledTimes(1);
  });

  it("skips a rail inside a hidden pane for its visible copy", () => {
    const pane = document.createElement("div");
    pane.hidden = true;
    const warm = mountRail("r1");
    pane.append(warm);
    document.body.append(pane);
    const rail = mountRail("r1");
    const { result } = renderScrollToTarget();

    act(() => {
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.RAIL, chunkId: "chunk-a", railKey: "r1" },
        { ...SMOOTH, focus: true, placement: ScrollPlacements.READING_BAND },
      );
      vi.advanceTimersByTime(1);
    });

    expect(document.activeElement).toBe(rail);
  });

  it("drops a rail scroll in flight when the brief changes", () => {
    const chunkWindows = {
      scrollToChunk: vi.fn(() => true),
      beginSmoothScroll: () => ignoreEnd,
    };
    const { result, rerender } = renderScrollToTarget(chunkWindows);

    act(() => {
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.RAIL, chunkId: "chunk-far", railKey: "r1" },
        { ...SMOOTH, focus: true, placement: ScrollPlacements.READING_BAND },
      );
      vi.advanceTimersByTime(1);
    });
    expect(chunkWindows.scrollToChunk).toHaveBeenCalledWith("chunk-far");
    rerender({ briefId: "brief-b", inChangesScope: false });
    const rail = mountRail("r1");
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(document.activeElement).not.toBe(rail);
    expect(rail.scrollIntoView).not.toHaveBeenCalled();
  });

  it("clears the flash when the brief changes", () => {
    const row = mountLineRow(mountCard("chunk-a", 300));
    const { result, rerender } = renderScrollToTarget();

    act(() => {
      result.current.scrollToTarget(LINE_ROW, ROW_SCROLL);
      vi.advanceTimersByTime(FRAME_MS * 2);
    });
    expect(row.hasAttribute(SCROLL_FLASH_ATTR)).toBe(true);
    rerender({ briefId: "brief-b", inChangesScope: false });

    expect(row.hasAttribute(SCROLL_FLASH_ATTR)).toBe(false);
  });

  it("waits for a section that mounts after the call", () => {
    const { result } = renderScrollToTarget();

    act(() => {
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.SECTION, sectionId: "intent-bar" },
        SMOOTH,
      );
      vi.advanceTimersByTime(FRAME_MS * 2);
    });
    const section = mountCard("intent-bar", 300);
    act(() => {
      vi.advanceTimersByTime(FRAME_MS * 8);
    });

    expect(window.scrollBy).toHaveBeenCalledWith({
      behavior: "instant",
      top: 300,
    });
    expect(section.scrollIntoView).not.toHaveBeenCalled();
  });

  it("re-places a section a reflow moved after it reached the top", () => {
    const section = mountCard("intent-bar", 300);
    section.scrollIntoView = vi.fn(() => {
      section.getBoundingClientRect = () => makeRect(0);
    });
    const { result } = renderScrollToTarget();

    act(() => {
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.SECTION, sectionId: "intent-bar" },
        SMOOTH,
      );
      vi.advanceTimersByTime(FRAME_MS * 20);
    });
    expect(window.scrollBy).not.toHaveBeenCalled();
    section.getBoundingClientRect = () => makeRect(120);
    act(() => {
      vi.advanceTimersByTime(FRAME_MS * 10);
    });

    expect(window.scrollBy).toHaveBeenCalledWith({
      behavior: "instant",
      top: 120,
    });
  });

  it("runs a push scroll at once outside Changes scope", () => {
    const card = mountCard("chunk-a", 300);
    const { result } = renderScrollToTarget();

    let scheduled = false;
    act(() => {
      scheduled = result.current.scrollToTarget(CHUNK_A, PUSH);
      vi.advanceTimersByTime(1);
    });

    expect(scheduled).toBe(true);
    expect(card.scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

describe("useScrollToTarget under reduced motion", () => {
  beforeEach(() => {
    setMediaQueryMatches("(prefers-reduced-motion: reduce)", true);
  });

  afterEach(resetMediaQueries);

  it("snaps an under-stack scroll instead of gliding", () => {
    mountCard("chunk-a", 300);
    const { result } = renderScrollToTarget();

    act(() => {
      result.current.scrollToTarget(CHUNK_A, {
        ...SMOOTH,
        placement: ScrollPlacements.UNDER_STACK,
      });
      vi.advanceTimersByTime(40);
    });

    expect(window.scrollTo).toHaveBeenCalledWith({
      behavior: "auto",
      top: 150,
    });
  });

  it("snaps a scroll into view instead of gliding", () => {
    const card = mountCard("chunk-a", 300);
    const { result } = renderScrollToTarget();

    act(() => {
      result.current.scrollToTarget(CHUNK_A, SMOOTH);
      vi.advanceTimersByTime(1);
    });

    expect(card.scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "start",
    });
  });
});

describe("useScrollToTarget from Changes scope", () => {
  it("parks a scroll and leaves the scope with a history step", () => {
    const card = mountCard("chunk-a", 300);
    const exitChangesScope = vi.fn();
    const { result } = renderChangesScroll(exitChangesScope);

    let scheduled = false;
    act(() => {
      scheduled = result.current.scrollToTarget(CHUNK_A, PUSH);
      vi.advanceTimersByTime(200);
    });

    expect(scheduled).toBe(true);
    expect(exitChangesScope).toHaveBeenCalledWith({ replace: false });
    expect(card.scrollIntoView).not.toHaveBeenCalled();
  });

  it("leaves the scope by replace for an arrival", () => {
    const exitChangesScope = vi.fn();
    const { result } = renderChangesScroll(exitChangesScope);

    act(() => {
      result.current.scrollToTarget(CHUNK_A, REPLACE);
    });

    expect(exitChangesScope).toHaveBeenCalledWith({ replace: true });
  });

  it("scrolls to the parked target once the story pane renders", () => {
    const card = mountCard("chunk-a", 300);
    const { result, rerender } = renderChangesScroll(vi.fn());

    act(() => {
      result.current.scrollToTarget(CHUNK_A, PUSH);
    });
    rerender({ briefId: "brief-a", inChangesScope: false });
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(card.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("lets a newer scroll replace the parked one", () => {
    const first = mountCard("chunk-a", 300);
    const second = mountCard("chunk-b", 600);
    const { result, rerender } = renderChangesScroll(vi.fn());

    act(() => {
      result.current.scrollToTarget(CHUNK_A, PUSH);
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.CHUNK, chunkId: "chunk-b" },
        PUSH,
      );
    });
    rerender({ briefId: "brief-a", inChangesScope: false });
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(first.scrollIntoView).not.toHaveBeenCalled();
    expect(second.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("drops a parked scroll when the brief changes", () => {
    const card = mountCard("chunk-a", 300);
    const { result, rerender } = renderChangesScroll(vi.fn());

    act(() => {
      result.current.scrollToTarget(CHUNK_A, { ...REPLACE, focus: true });
    });
    rerender({ briefId: "brief-b", inChangesScope: false });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(card.scrollIntoView).not.toHaveBeenCalled();
    expect(window.scrollBy).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(card);
  });

  it("focuses a parked group's heading once it arrives", () => {
    const { result, rerender } = renderChangesScroll(vi.fn());

    act(() => {
      result.current.scrollToTarget(
        { kind: ScrollTargetKinds.GROUP, groupId: "g1" },
        { ...PUSH, focus: true, placement: ScrollPlacements.UNDER_STACK },
      );
    });
    const section = document.createElement("section");
    section.id = deriveGroupSectionId("g1");
    section.getBoundingClientRect = () => makeRect(300);
    const heading = document.createElement("h2");
    heading.id = deriveGroupHeadingId("g1");
    heading.tabIndex = -1;
    section.append(heading);
    document.body.append(section);
    expect(document.activeElement).not.toBe(heading);
    rerender({ briefId: "brief-a", inChangesScope: false });
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(document.activeElement).toBe(heading);
  });

  it("runs a history-free scroll where it is, without leaving", () => {
    const card = mountCard("chunk-a", 300);
    const exitChangesScope = vi.fn();
    const { result } = renderChangesScroll(exitChangesScope);

    act(() => {
      result.current.scrollToTarget(CHUNK_A, SMOOTH);
      vi.advanceTimersByTime(1);
    });

    expect(exitChangesScope).not.toHaveBeenCalled();
    expect(card.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("refuses a scroll that must leave Changes scope without an exit", () => {
    const card = mountCard("chunk-a", 300);
    const { result, rerender } = renderChangesScroll(undefined);

    let scheduled = true;
    act(() => {
      scheduled = result.current.scrollToTarget(CHUNK_A, PUSH);
    });
    rerender({ briefId: "brief-a", inChangesScope: false });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(scheduled).toBe(false);
    expect(card.scrollIntoView).not.toHaveBeenCalled();
  });

  it("refuses a scroll asked after the page unmounted", () => {
    const card = mountCard("chunk-a", 300);
    const exitChangesScope = vi.fn();
    const { result, unmount } = renderChangesScroll(exitChangesScope);
    const { scrollToTarget } = result.current;
    unmount();

    let scheduled = true;
    act(() => {
      scheduled = scrollToTarget(CHUNK_A, REPLACE);
      scheduled = scrollToTarget(CHUNK_A, SMOOTH) || scheduled;
      vi.advanceTimersByTime(200);
    });

    expect(scheduled).toBe(false);
    expect(exitChangesScope).not.toHaveBeenCalled();
    expect(card.scrollIntoView).not.toHaveBeenCalled();
    expect(window.scrollBy).not.toHaveBeenCalled();
  });
});
