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
    expect(frames).toHaveLength(0);
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

    expect(scrollBy).toHaveBeenCalledWith({ behavior: "instant", top: -66 });
    expect(scrollBy).toHaveBeenCalledTimes(1);
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
