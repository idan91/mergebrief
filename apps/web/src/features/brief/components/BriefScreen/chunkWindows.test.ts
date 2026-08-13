import { describe, expect, it, vi } from "vitest";

import { createChunkWindowRegistry } from "./chunkWindows";

describe("chunk window registry", () => {
  it("tries registrations in order until one accepts", () => {
    const registry = createChunkWindowRegistry();
    const refusing = vi.fn(() => false);
    const accepting = vi.fn(() => true);
    const never = vi.fn(() => true);
    registry.register({ scrollToChunk: refusing });
    registry.register({ scrollToChunk: accepting });
    registry.register({ scrollToChunk: never });

    expect(registry.scrollToChunk("c1")).toBe(true);
    expect(refusing).toHaveBeenCalledWith("c1");
    expect(accepting).toHaveBeenCalledWith("c1");
    expect(never).not.toHaveBeenCalled();
  });

  it("returns false when every registration refuses (hidden panes, unknown id)", () => {
    const registry = createChunkWindowRegistry();
    registry.register({ scrollToChunk: () => false });
    registry.register({ scrollToChunk: () => false });
    expect(registry.scrollToChunk("missing")).toBe(false);
  });

  it("returns false with no registrations at all", () => {
    expect(createChunkWindowRegistry().scrollToChunk("c1")).toBe(false);
  });

  it("deregistration removes exactly the returned registration", () => {
    const registry = createChunkWindowRegistry();
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const unregister = registry.register({ scrollToChunk: first });
    registry.register({ scrollToChunk: second });
    unregister();

    expect(registry.scrollToChunk("c1")).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("c1");
  });
});
