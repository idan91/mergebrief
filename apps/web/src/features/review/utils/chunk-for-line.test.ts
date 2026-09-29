import { describe, expect, it } from "vitest";

import { Concerns, Roles, type BriefChunk } from "../../brief/types";
import { resolveChunkForLine } from "./chunk-for-line";

function stubChunk(overrides: Partial<BriefChunk>): BriefChunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/a.ts",
    concern: Concerns.IMPLEMENTATION,
    role: Roles.CORE,
    loc: { added: 0, deleted: 0 },
    addedRanges: [],
    removedRanges: [],
    riskSurface: [],
    ...overrides,
  };
}

const CHUNKS: BriefChunk[] = [
  stubChunk({
    id: "c1",
    addedRanges: [
      { start: 10, end: 12 },
      { start: 20, end: 21 },
    ],
  }),
  stubChunk({
    id: "c2",
    addedRanges: [{ start: 40, end: 41 }],
    removedRanges: [{ start: 38, end: 39 }],
  }),
  stubChunk({
    id: "other",
    file: "src/b.ts",
    addedRanges: [{ start: 5, end: 6 }],
  }),
];

describe("resolveChunkForLine", () => {
  it("names the chunk whose ranges on the side hold the line", () => {
    expect(resolveChunkForLine(CHUNKS, "src/a.ts", "new", 41)?.id).toBe("c2");
    expect(resolveChunkForLine(CHUNKS, "src/a.ts", "old", 38)?.id).toBe("c2");
  });

  it("falls to the chunk whose envelope holds a context line", () => {
    expect(resolveChunkForLine(CHUNKS, "src/a.ts", "new", 15)?.id).toBe("c1");
  });

  it("falls to the nearest chunk before a line past every envelope", () => {
    expect(resolveChunkForLine(CHUNKS, "src/a.ts", "new", 30)?.id).toBe("c1");
    expect(resolveChunkForLine(CHUNKS, "src/a.ts", "new", 99)?.id).toBe("c2");
  });

  it("falls to the file's first chunk for a line before every chunk", () => {
    expect(resolveChunkForLine(CHUNKS, "src/a.ts", "new", 2)?.id).toBe("c1");
  });

  it("never answers a chunk of another file", () => {
    expect(resolveChunkForLine(CHUNKS, "src/c.ts", "new", 10)).toBeUndefined();
    expect(resolveChunkForLine(CHUNKS, "src/b.ts", "new", 5)?.id).toBe("other");
  });
});
