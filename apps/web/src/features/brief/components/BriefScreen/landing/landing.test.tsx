// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REVISION_JUMP_ATTR } from "../../../comparison/runs";
import type { ScopeExitOptions } from "../types";
import { deriveGroupHeadingId, deriveGroupSectionId } from "../utils";
import { useLanding } from ".";
import { FLASH_MS, LANDING_FLASH_ATTR, MOUNT_POLL_FRAMES } from "./consts";
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

const SMOOTH: LandOptions = {
  motion: LandMotions.SMOOTH,
  history: LandHistories.NONE,
};
const PUSH: LandOptions = { ...SMOOTH, history: LandHistories.PUSH };
const REPLACE: LandOptions = { ...SMOOTH, history: LandHistories.REPLACE };

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

const ROW_LANDING: LandOptions = {
  ...SMOOTH,
  open: true,
  focus: true,
  flash: true,
  placement: LandPlacements.READING_BAND,
};

const LINE_ROW = {
  kind: LandTargetKinds.ROW,
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

function renderLanding(
  chunkWindows?: ChunkWindowsPort,
  openChunk: (chunkId: string) => void = vi.fn(),
) {
  return renderHook(
    ({ briefId, inChangesScope }: HostProps) =>
      useLanding({
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
function renderChangesLanding(
  exitChangesScope: ((options: ScopeExitOptions) => void) | undefined,
) {
  return renderHook(
    ({ briefId, inChangesScope }: HostProps) =>
      useLanding({
        briefId,
        chunkWindows: undefined,
        openChunk: vi.fn(),
        inChangesScope,
        exitChangesScope,
      }),
    { initialProps: { briefId: "brief-a", inChangesScope: true } },
  );
}

const CHUNK_A = { kind: LandTargetKinds.CHUNK, chunkId: "chunk-a" } as const;

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
      vi.advanceTimersByTime(1);
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

  it("stops re-placing once the reader presses a pointer in the card", () => {
    const card = mountCard("chunk-a", 9000);
    const inner = document.createElement("button");
    card.append(inner);
    inner.addEventListener("pointerdown", (event) => event.stopPropagation());
    const { result } = renderLanding();

    act(() => {
      result.current.land(
        { kind: LandTargetKinds.CHUNK, chunkId: "chunk-a" },
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
    rerender({ briefId: "brief-b", inChangesScope: false });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(card.scrollIntoView).not.toHaveBeenCalled();
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it("lands on a line's row, focuses it and flashes it", () => {
    const row = mountLineRow(mountCard("chunk-a", 300));
    const openChunk = vi.fn();
    const { result } = renderLanding(undefined, openChunk);

    act(() => {
      result.current.land(LINE_ROW, ROW_LANDING);
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
    expect(row.hasAttribute(LANDING_FLASH_ATTR)).toBe(true);

    act(() => {
      vi.advanceTimersByTime(FLASH_MS);
    });
    expect(row.hasAttribute(LANDING_FLASH_ATTR)).toBe(false);
  });

  it("focuses a thread row's disclosure, not the row", () => {
    const card = mountCard("chunk-a", 300);
    card.innerHTML =
      '<table><tbody><tr data-conversation-thread="7"><td><button>open</button></td></tr></tbody></table>';
    const { result } = renderLanding();

    act(() => {
      result.current.land(
        {
          kind: LandTargetKinds.ROW,
          chunkId: "chunk-a",
          row: { rowId: "chunk-a:0", threadId: 7 },
        },
        ROW_LANDING,
      );
      vi.advanceTimersByTime(1);
    });

    expect(document.activeElement).toBe(card.querySelector("button"));
  });

  it("focuses a row whose card the same click reveals", () => {
    const card = mountCard("chunk-a", 300);
    const row = mountLineRow(card);
    stubFocusWhenRendered(row, () => card.hasAttribute("data-current"));
    const { result } = renderLanding();

    act(() => {
      result.current.land(LINE_ROW, ROW_LANDING);
      card.setAttribute("data-current", "");
    });
    act(() => {
      vi.advanceTimersByTime(FRAME_MS * 2);
    });

    expect(document.activeElement).toBe(row);
  });

  it("concedes to the card when the row never renders", () => {
    const card = mountCard("chunk-a", 300);
    const { result } = renderLanding();

    act(() => {
      result.current.land(LINE_ROW, ROW_LANDING);
      vi.advanceTimersByTime(FRAME_MS * (MOUNT_POLL_FRAMES + 4));
    });

    expect(document.activeElement).toBe(card);
    expect(card.hasAttribute(LANDING_FLASH_ATTR)).toBe(true);
  });

  it("lands on a rail and focuses its button without scrolling", () => {
    const rail = mountRail("r1");
    const focus = vi.spyOn(rail, "focus");
    const { result } = renderLanding();

    act(() => {
      result.current.land(
        { kind: LandTargetKinds.RAIL, chunkId: "chunk-a", railKey: "r1" },
        { ...SMOOTH, focus: true, placement: LandPlacements.READING_BAND },
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
    const { result } = renderLanding();

    act(() => {
      result.current.land(
        { kind: LandTargetKinds.RAIL, chunkId: "chunk-a", railKey: "r1" },
        { ...SMOOTH, placement: LandPlacements.READING_BAND },
      );
      vi.advanceTimersByTime(FRAME_MS * 60);
    });

    expect(querySelectorAll).toHaveBeenCalledTimes(1);
  });

  it("finds the rail again when its node is replaced mid-watch", () => {
    const first = mountRail("r1");
    const { result } = renderLanding();

    act(() => {
      result.current.land(
        { kind: LandTargetKinds.RAIL, chunkId: "chunk-a", railKey: "r1" },
        { ...SMOOTH, placement: LandPlacements.READING_BAND },
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
    const { result } = renderLanding();

    act(() => {
      result.current.land(
        { kind: LandTargetKinds.RAIL, chunkId: "chunk-a", railKey: "r1" },
        { ...SMOOTH, focus: true, placement: LandPlacements.READING_BAND },
      );
      vi.advanceTimersByTime(1);
    });

    expect(document.activeElement).toBe(rail);
  });

  it("drops a rail landing in flight when the brief changes", () => {
    const chunkWindows = { scrollToChunk: vi.fn(() => true) };
    const { result, rerender } = renderLanding(chunkWindows);

    act(() => {
      result.current.land(
        { kind: LandTargetKinds.RAIL, chunkId: "chunk-far", railKey: "r1" },
        { ...SMOOTH, focus: true, placement: LandPlacements.READING_BAND },
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
    const { result, rerender } = renderLanding();

    act(() => {
      result.current.land(LINE_ROW, ROW_LANDING);
      vi.advanceTimersByTime(FRAME_MS * 2);
    });
    expect(row.hasAttribute(LANDING_FLASH_ATTR)).toBe(true);
    rerender({ briefId: "brief-b", inChangesScope: false });

    expect(row.hasAttribute(LANDING_FLASH_ATTR)).toBe(false);
  });

  it("waits for a section that mounts after the call", () => {
    const { result } = renderLanding();

    act(() => {
      result.current.land(
        { kind: LandTargetKinds.SECTION, sectionId: "intent-bar" },
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
    const { result } = renderLanding();

    act(() => {
      result.current.land(
        { kind: LandTargetKinds.SECTION, sectionId: "intent-bar" },
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

  it("lands a push landing at once outside Changes scope", () => {
    const card = mountCard("chunk-a", 300);
    const { result } = renderLanding();

    let scheduled = false;
    act(() => {
      scheduled = result.current.land(CHUNK_A, PUSH);
      vi.advanceTimersByTime(1);
    });

    expect(scheduled).toBe(true);
    expect(card.scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

describe("useLanding from Changes scope", () => {
  it("parks a landing and leaves the scope with a history step", () => {
    const card = mountCard("chunk-a", 300);
    const exitChangesScope = vi.fn();
    const { result } = renderChangesLanding(exitChangesScope);

    let scheduled = false;
    act(() => {
      scheduled = result.current.land(CHUNK_A, PUSH);
      vi.advanceTimersByTime(200);
    });

    expect(scheduled).toBe(true);
    expect(exitChangesScope).toHaveBeenCalledWith({ replace: false });
    expect(card.scrollIntoView).not.toHaveBeenCalled();
  });

  it("leaves the scope by replace for an arrival", () => {
    const exitChangesScope = vi.fn();
    const { result } = renderChangesLanding(exitChangesScope);

    act(() => {
      result.current.land(CHUNK_A, REPLACE);
    });

    expect(exitChangesScope).toHaveBeenCalledWith({ replace: true });
  });

  it("lands the parked target once the story pane renders", () => {
    const card = mountCard("chunk-a", 300);
    const { result, rerender } = renderChangesLanding(vi.fn());

    act(() => {
      result.current.land(CHUNK_A, PUSH);
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

  it("lets a newer landing replace the parked one", () => {
    const first = mountCard("chunk-a", 300);
    const second = mountCard("chunk-b", 600);
    const { result, rerender } = renderChangesLanding(vi.fn());

    act(() => {
      result.current.land(CHUNK_A, PUSH);
      result.current.land(
        { kind: LandTargetKinds.CHUNK, chunkId: "chunk-b" },
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

  it("drops a parked landing when the brief changes", () => {
    const card = mountCard("chunk-a", 300);
    const { result, rerender } = renderChangesLanding(vi.fn());

    act(() => {
      result.current.land(CHUNK_A, { ...REPLACE, focus: true });
    });
    rerender({ briefId: "brief-b", inChangesScope: false });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(card.scrollIntoView).not.toHaveBeenCalled();
    expect(window.scrollBy).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(card);
  });

  it("focuses a parked group's heading once it lands", () => {
    const { result, rerender } = renderChangesLanding(vi.fn());

    act(() => {
      result.current.land(
        { kind: LandTargetKinds.GROUP, groupId: "g1" },
        { ...PUSH, focus: true, placement: LandPlacements.UNDER_STACK },
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

  it("lands a history-free landing where it is, without leaving", () => {
    const card = mountCard("chunk-a", 300);
    const exitChangesScope = vi.fn();
    const { result } = renderChangesLanding(exitChangesScope);

    act(() => {
      result.current.land(CHUNK_A, SMOOTH);
      vi.advanceTimersByTime(1);
    });

    expect(exitChangesScope).not.toHaveBeenCalled();
    expect(card.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("refuses a landing that must leave Changes scope without an exit", () => {
    const card = mountCard("chunk-a", 300);
    const { result, rerender } = renderChangesLanding(undefined);

    let scheduled = true;
    act(() => {
      scheduled = result.current.land(CHUNK_A, PUSH);
    });
    rerender({ briefId: "brief-a", inChangesScope: false });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(scheduled).toBe(false);
    expect(card.scrollIntoView).not.toHaveBeenCalled();
  });

  it("refuses a landing asked after the page unmounted", () => {
    const card = mountCard("chunk-a", 300);
    const exitChangesScope = vi.fn();
    const { result, unmount } = renderChangesLanding(exitChangesScope);
    const { land } = result.current;
    unmount();

    let scheduled = true;
    act(() => {
      scheduled = land(CHUNK_A, REPLACE);
      scheduled = land(CHUNK_A, SMOOTH) || scheduled;
      vi.advanceTimersByTime(200);
    });

    expect(scheduled).toBe(false);
    expect(exitChangesScope).not.toHaveBeenCalled();
    expect(card.scrollIntoView).not.toHaveBeenCalled();
    expect(window.scrollBy).not.toHaveBeenCalled();
  });
});
