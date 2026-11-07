import { describe, expect, it } from "vitest";

import { resolveChunkStepTargets, resolveGapStepTargets } from "./utils";

const chunkIds = ["c1", "c2", "c3"];

describe("resolveChunkStepTargets", () => {
  it("steps to the neighbours of the active chunk", () => {
    expect(resolveChunkStepTargets(chunkIds, "c2")).toEqual({
      previous: "c1",
      next: "c3",
    });
  });

  it("offers only Next at the first chunk and only Previous at the last", () => {
    expect(resolveChunkStepTargets(chunkIds, "c1")).toEqual({ next: "c2" });
    expect(resolveChunkStepTargets(chunkIds, "c3")).toEqual({
      previous: "c2",
    });
  });

  it("opens the first chunk from Overview", () => {
    expect(resolveChunkStepTargets(chunkIds, undefined)).toEqual({
      next: "c1",
    });
    expect(resolveChunkStepTargets(chunkIds, "gone")).toEqual({ next: "c1" });
  });

  it("offers nothing with no chunks", () => {
    expect(resolveChunkStepTargets([], undefined)).toEqual({});
  });
});

describe("resolveGapStepTargets", () => {
  it("steps from a gap below the active chunk to its two sides", () => {
    const gap = { activeBelowReader: false };

    expect(resolveGapStepTargets(chunkIds, "c2", gap)).toEqual({
      previous: "c2",
      next: "c3",
    });
    expect(resolveGapStepTargets(chunkIds, "c3", gap)).toEqual({
      previous: "c3",
    });
  });

  it("steps from a gap above the active chunk to its two sides", () => {
    const gap = { activeBelowReader: true };

    expect(resolveGapStepTargets(chunkIds, "c2", gap)).toEqual({
      previous: "c1",
      next: "c2",
    });
    expect(resolveGapStepTargets(chunkIds, "c1", gap)).toEqual({ next: "c1" });
  });

  it("falls back to the Overview steps for an unknown chunk", () => {
    const gap = { activeBelowReader: true };

    expect(resolveGapStepTargets(chunkIds, "gone", gap)).toEqual({
      next: "c1",
    });
  });
});
