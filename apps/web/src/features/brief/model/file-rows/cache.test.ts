import { describe, expect, it } from "vitest";

import type { BriefChunk } from "../types";
import { createFileRowsCache } from "./cache";

const APP_PATCH = [
  "diff --git a/src/app.ts b/src/app.ts",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,2 +1,2 @@",
  "-const a = 1;",
  "+const a = 10;",
  " const b = 2;",
].join("\n");

function stubPatches(): ReadonlyMap<string, string> {
  return new Map([["src/app.ts", APP_PATCH]]);
}

describe("createFileRowsCache", () => {
  it("parses each file once and hands back the same rows on a second read", () => {
    const cache = createFileRowsCache(stubPatches());

    expect(cache.getFileRows("src/app.ts")).toBe(
      cache.getFileRows("src/app.ts"),
    );
  });
});

function stubChunk(overrides: Partial<BriefChunk> = {}): BriefChunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/app.ts",
    concern: "implementation",
    role: "core",
    loc: { added: 1, deleted: 1 },
    addedRanges: [{ start: 1, end: 1 }],
    removedRanges: [],
    riskSurface: [],
    ...overrides,
  };
}

function stubCountingPatches(): {
  patches: Map<string, string>;
  reads: () => number;
} {
  let reads = 0;
  const patches = new Map([["src/app.ts", APP_PATCH]]);
  const get = patches.get.bind(patches);
  patches.get = (path: string) => {
    reads += 1;
    return get(path);
  };
  return { patches, reads: () => reads };
}

describe("FileRowsCache.attachChunkRows", () => {
  it("parses the chunk's file only when its rows are first read", () => {
    const { patches, reads } = stubCountingPatches();
    const cache = createFileRowsCache(patches);

    const attached = cache.attachChunkRows(stubChunk());
    const before = reads();
    const rows = attached.diff?.map((row) => row.content);

    expect(before).toBe(0);
    expect(rows).toEqual([
      "@@ -1,2 +1,2 @@",
      "const a = 1;",
      "const a = 10;",
      "const b = 2;",
    ]);
    expect(reads()).toBe(1);
  });

  it("hands back the same attached chunk on every call", () => {
    const cache = createFileRowsCache(stubPatches());
    const chunk = stubChunk();

    expect(cache.attachChunkRows(chunk)).toBe(cache.attachChunkRows(chunk));
  });

  it("leaves a chunk whose file the diff lacks as itself", () => {
    const cache = createFileRowsCache(stubPatches());
    const chunk = stubChunk({ file: "not/in/diff.ts" });

    expect(cache.attachChunkRows(chunk)).toBe(chunk);
  });

  it("hands back a chunk it already attached as itself", () => {
    const cache = createFileRowsCache(stubPatches());
    const attached = cache.attachChunkRows(stubChunk({ diff: [] }));

    expect(cache.attachChunkRows(attached)).toBe(attached);
    expect(attached.diff).toHaveLength(4);
  });

  it("leaves a remainder chunk's forwarded rows unread", () => {
    const cache = createFileRowsCache(stubPatches());
    let reads = 0;
    const remainder = stubChunk();
    Object.defineProperty(remainder, "diff", {
      enumerable: true,
      get: () => {
        reads += 1;
        return [];
      },
    });

    expect(cache.attachChunkRows(remainder)).toBe(remainder);
    expect(reads).toBe(0);
  });

  it("slices an unattributed entry the same way", () => {
    const cache = createFileRowsCache(stubPatches());
    const entry = {
      file: "src/app.ts",
      addedRanges: [],
      removedRanges: [{ start: 1, end: 1 }],
    };

    const attached = cache.attachEntryRows(entry);

    expect(attached.diff?.map((row) => row.kind)).toEqual([
      "hunk",
      "del",
      "add",
      "ctx",
    ]);
    expect(entry).not.toHaveProperty("diff");
  });
});
