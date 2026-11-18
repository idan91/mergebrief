import { afterEach, describe, expect, it, vi } from "vitest";

import { createChunkWindowRegistry } from "./chunk-windows";

function ignoreHold(): void {}

describe("chunk window registry", () => {
  it("tries registrations in order until one accepts", () => {
    const registry = createChunkWindowRegistry();
    const refusing = vi.fn(() => false);
    const accepting = vi.fn(() => true);
    const never = vi.fn(() => true);
    registry.register({
      scrollToChunk: refusing,
      holdScrollCompensation: ignoreHold,
    });
    registry.register({
      scrollToChunk: accepting,
      holdScrollCompensation: ignoreHold,
    });
    registry.register({
      scrollToChunk: never,
      holdScrollCompensation: ignoreHold,
    });

    expect(registry.scrollToChunk("c1")).toBe(true);
    expect(refusing).toHaveBeenCalledWith("c1");
    expect(accepting).toHaveBeenCalledWith("c1");
    expect(never).not.toHaveBeenCalled();
  });

  it("returns false when every registration refuses the id", () => {
    const registry = createChunkWindowRegistry();
    registry.register({
      scrollToChunk: () => false,
      holdScrollCompensation: ignoreHold,
    });
    registry.register({
      scrollToChunk: () => false,
      holdScrollCompensation: ignoreHold,
    });
    expect(registry.scrollToChunk("missing")).toBe(false);
  });

  it("deregistration removes exactly the returned registration", () => {
    const registry = createChunkWindowRegistry();
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const unregister = registry.register({
      scrollToChunk: first,
      holdScrollCompensation: ignoreHold,
    });
    registry.register({
      scrollToChunk: second,
      holdScrollCompensation: ignoreHold,
    });
    unregister();

    expect(registry.scrollToChunk("c1")).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("c1");
  });

  it("holds and releases compensation on every registration", () => {
    const registry = createChunkWindowRegistry();
    const story = vi.fn();
    const changes = vi.fn();
    registry.register({
      scrollToChunk: () => false,
      holdScrollCompensation: story,
    });
    registry.register({
      scrollToChunk: () => false,
      holdScrollCompensation: changes,
    });

    const release = registry.holdScrollCompensation();
    release();

    expect(story.mock.calls).toEqual([[true], [false]]);
    expect(changes.mock.calls).toEqual([[true], [false]]);
  });

  it("keeps the windows held until the last of nested holds is released", () => {
    const registry = createChunkWindowRegistry();
    const story = vi.fn();
    registry.register({
      scrollToChunk: () => false,
      holdScrollCompensation: story,
    });

    const releaseFirst = registry.holdScrollCompensation();
    const releaseSecond = registry.holdScrollCompensation();
    releaseFirst();
    releaseFirst();
    expect(story.mock.calls).toEqual([[true]]);

    releaseSecond();
    expect(story.mock.calls).toEqual([[true], [false]]);
  });

  it("holds a window that registers while a hold is live", () => {
    const registry = createChunkWindowRegistry();
    const release = registry.holdScrollCompensation();
    const late = vi.fn();
    registry.register({
      scrollToChunk: () => false,
      holdScrollCompensation: late,
    });
    release();

    expect(late.mock.calls).toEqual([[true], [false]]);
  });

  it("reports a smooth scroll until each one in flight has ended", () => {
    const registry = createChunkWindowRegistry();
    const endFirst = registry.beginSmoothScroll();
    const endSecond = registry.beginSmoothScroll();

    endFirst();
    endFirst();
    expect(registry.isSmoothScrolling()).toBe(true);

    endSecond();
    expect(registry.isSmoothScrolling()).toBe(false);
  });

  describe("scroll anchoring", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function stubRootStyle(): { overflowAnchor: string } {
      const style = { overflowAnchor: "" };
      vi.stubGlobal("document", { documentElement: { style } });
      return style;
    }

    it("pauses anchoring while a scripted scroll is in flight", () => {
      const style = stubRootStyle();
      const registry = createChunkWindowRegistry();

      const end = registry.beginSmoothScroll();
      expect(style.overflowAnchor).toBe("none");

      end();
      expect(style.overflowAnchor).toBe("");
    });

    it("keeps anchoring paused until the last hold and flight end", () => {
      const style = stubRootStyle();
      const registry = createChunkWindowRegistry();
      const release = registry.holdScrollCompensation();
      const end = registry.beginSmoothScroll();

      release();
      expect(style.overflowAnchor).toBe("none");

      end();
      expect(style.overflowAnchor).toBe("");
    });
  });
});
