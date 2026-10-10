// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { focusConversationHeading } from "./utils";

let frames: FrameRequestCallback[] = [];

function runFrames(count: number) {
  for (let ran = 0; ran < count; ran += 1) {
    const frame = frames.shift();
    if (frame === undefined) {
      return;
    }
    frame(0);
  }
}

beforeEach(() => {
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((frame) => {
    frames.push(frame);
    return frames.length;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
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
