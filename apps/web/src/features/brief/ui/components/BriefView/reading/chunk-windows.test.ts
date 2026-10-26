import { describe, expect, it, vi } from "vitest";

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

    registry.holdScrollCompensation(true);
    registry.holdScrollCompensation(false);

    expect(story.mock.calls).toEqual([[true], [false]]);
    expect(changes.mock.calls).toEqual([[true], [false]]);
  });
});
