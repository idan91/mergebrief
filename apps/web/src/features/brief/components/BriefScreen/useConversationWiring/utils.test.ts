// @vitest-environment jsdom
// The landing polls frame by frame: frames are queued by hand, so each test
// decides exactly when the card or the row shows up.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LANDING_POLL_FRAMES } from "./consts";
import type { LandingContext } from "./types";
import {
  armLandingAbort,
  focusConversationHeading,
  landOnChunkCard,
  landOnTargetRow,
} from "./utils";

const THREAD = { rowId: "c1:0", threadId: 7 };

let frames: FrameRequestCallback[] = [];
const scrollBy = vi.fn();
const nativeScrollBy = window.scrollBy;

function runFrames(count: number) {
  for (let ran = 0; ran < count; ran += 1) {
    const frame = frames.shift();
    if (frame === undefined) return;
    frame(0);
  }
}

function makeContext(): LandingContext {
  return {
    frameRef: { current: null },
    flashTarget: vi.fn(),
    cancelChunkScroll: vi.fn(),
  };
}

function mountCard(): HTMLElement {
  const card = document.createElement("section");
  card.id = "c1";
  card.tabIndex = -1;
  document.body.append(card);
  return card;
}

function mountThreadRow(card: HTMLElement, rowTop: number): HTMLElement {
  card.innerHTML =
    '<table><tbody><tr data-conversation-thread="7"><td><button>open</button></td></tr></tbody></table>';
  const row = card.querySelector("tr")!;
  row.scrollIntoView = vi.fn();
  row.getBoundingClientRect = () =>
    ({ top: rowTop, bottom: rowTop + 44 }) as DOMRect;
  return row;
}

beforeEach(() => {
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((frame) => {
    frames.push(frame);
    return frames.length;
  });
  window.scrollBy = scrollBy;
  document.documentElement.style.setProperty("--sticky-stack-h", "190px");
  // The band is 190 to 1000, a third of the way down 460.
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 1000,
  });
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
  scrollBy.mockReset();
  window.scrollBy = nativeScrollBy;
  document.documentElement.style.removeProperty("--sticky-stack-h");
  document.body.replaceChildren();
});

describe("armLandingAbort", () => {
  it("cancels on the user's own input", () => {
    const cancel = vi.fn();
    armLandingAbort(cancel);

    window.dispatchEvent(new Event("wheel"));

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("stops listening once the remover runs", () => {
    const cancel = vi.fn();
    const removeAbort = armLandingAbort(cancel);

    removeAbort();
    window.dispatchEvent(new Event("wheel"));
    window.dispatchEvent(new Event("keydown"));
    window.dispatchEvent(new Event("touchstart"));

    expect(cancel).not.toHaveBeenCalled();
  });
});

describe("landOnChunkCard", () => {
  it("focuses and flashes a card that is already mounted", () => {
    const context = makeContext();
    const card = mountCard();

    landOnChunkCard(context, "c1", LANDING_POLL_FRAMES);

    expect(document.activeElement).toBe(card);
    expect(context.flashTarget).toHaveBeenCalledWith(card);
    // The drift watch is armed; nothing else is pending.
    expect(frames).toHaveLength(1);
  });

  it("brings a card back that the list's measurements pushed away", () => {
    const context = makeContext();
    const card = mountCard();
    card.getBoundingClientRect = () => ({ top: 1200, bottom: 1440 }) as DOMRect;

    landOnChunkCard(context, "c1", LANDING_POLL_FRAMES);
    runFrames(LANDING_POLL_FRAMES);

    expect(scrollBy).toHaveBeenCalledWith({ behavior: "instant", top: 970 });
  });

  it("keeps polling until the windowed list mounts the card", () => {
    const context = makeContext();
    landOnChunkCard(context, "c1", LANDING_POLL_FRAMES);
    runFrames(2);
    expect(context.flashTarget).not.toHaveBeenCalled();

    const card = mountCard();
    runFrames(1);

    expect(context.flashTarget).toHaveBeenCalledWith(card);
  });

  it("gives up once its attempts are spent", () => {
    const context = makeContext();

    landOnChunkCard(context, "c1", 2);
    runFrames(5);

    expect(context.flashTarget).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
    expect(context.frameRef.current).toBeNull();
  });
});

describe("landOnTargetRow", () => {
  it("takes the scroll over and lands on the thread's disclosure", () => {
    const context = makeContext();
    const row = mountThreadRow(mountCard(), 400);

    landOnTargetRow(context, "c1", THREAD, LANDING_POLL_FRAMES);

    expect(context.cancelChunkScroll).toHaveBeenCalledTimes(1);
    expect(row.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: "center" }),
    );
    expect(document.activeElement).toBe(row.querySelector("button"));
    expect(context.flashTarget).toHaveBeenCalledWith(row);
  });

  it("concedes to the chunk's card when the row never renders", () => {
    const context = makeContext();
    const card = mountCard();

    landOnTargetRow(context, "c1", THREAD, 3);
    runFrames(5);

    expect(context.cancelChunkScroll).not.toHaveBeenCalled();
    expect(context.flashTarget).toHaveBeenCalledWith(card);
  });

  it("corrects a row the settled scroll left under the sticky stack", () => {
    const context = makeContext();
    mountThreadRow(mountCard(), 140);

    landOnTargetRow(context, "c1", THREAD, LANDING_POLL_FRAMES);
    runFrames(LANDING_POLL_FRAMES);

    expect(scrollBy).toHaveBeenCalledWith({ behavior: "instant", top: -320 });
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it("corrects a row again when the page moves after it landed", () => {
    const context = makeContext();
    const row = mountThreadRow(mountCard(), 400);

    landOnTargetRow(context, "c1", THREAD, LANDING_POLL_FRAMES);
    runFrames(30);
    expect(scrollBy).not.toHaveBeenCalled();

    // A reflow moves the row down the document, then the scroll comes to rest.
    row.getBoundingClientRect = () => ({ top: 980, bottom: 1024 }) as DOMRect;
    Object.defineProperty(window, "scrollY", { configurable: true, value: 50 });
    runFrames(30);

    expect(scrollBy).toHaveBeenCalledWith({ behavior: "instant", top: 520 });
  });

  it("ends the watch when the page scrolls and the row stays put", () => {
    const context = makeContext();
    const row = mountThreadRow(mountCard(), 400);

    landOnTargetRow(context, "c1", THREAD, LANDING_POLL_FRAMES);
    runFrames(30);
    // The reader scrolls 2000px away: the row's place in the document holds.
    row.getBoundingClientRect = () =>
      ({ top: 400 - 2000, bottom: 444 - 2000 }) as DOMRect;
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 2000,
    });
    runFrames(1);

    expect(frames).toHaveLength(0);
    runFrames(30);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("leaves a row that settled in view where it is", () => {
    const context = makeContext();
    mountThreadRow(mountCard(), 400);

    landOnTargetRow(context, "c1", THREAD, LANDING_POLL_FRAMES);
    runFrames(LANDING_POLL_FRAMES);

    expect(scrollBy).not.toHaveBeenCalled();
  });
});

describe("focusConversationHeading", () => {
  it("scrolls to and focuses the heading a frame later", () => {
    const heading = document.createElement("h2");
    heading.id = "conversation-heading";
    heading.tabIndex = -1;
    heading.scrollIntoView = vi.fn();
    document.body.append(heading);

    focusConversationHeading();
    expect(document.activeElement).not.toBe(heading);
    runFrames(1);

    expect(heading.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(document.activeElement).toBe(heading);
  });
});
