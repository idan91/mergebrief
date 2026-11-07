import { describe, expect, it } from "vitest";

import { resolveChunkStepTargets } from "./utils";

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
