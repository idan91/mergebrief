import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod/v4";
import {
  ChunkLayoutBodySchema,
  type ChunkLayoutCountsSchema,
} from "../../src/artifact";
import {
  countChunkLayout,
  parseUnifiedDiffPatch,
  type ChunkLayoutBody,
  type StoredChunkLayoutCounts,
} from "../../src/diff/chunk-layout";
import { PATCH } from "../diff/chunk-layout/helpers";

const HEAD_RANGES = {
  addedRanges: [{ start: 2, end: 3 }],
  removedRanges: [],
};

function makeCounts(): StoredChunkLayoutCounts {
  return countChunkLayout(parseUnifiedDiffPatch(PATCH), HEAD_RANGES);
}

describe("ChunkLayoutBodySchema", () => {
  it("accepts what countChunkLayout builds", () => {
    const body: ChunkLayoutBody = {
      chunks: { c1: makeCounts() },
      files: { "src/app.ts": makeCounts() },
    };

    expect(ChunkLayoutBodySchema.safeParse(body).success).toBe(true);
  });

  it("refuses row runs carrying code text", () => {
    const body = {
      chunks: { c1: { ...makeCounts(), rowRuns: "h1c2 const a = 1;" } },
      files: {},
    };

    expect(ChunkLayoutBodySchema.safeParse(body).success).toBe(false);
  });

  it("refuses counts without row runs", () => {
    const { rowRuns: _dropped, ...counts } = makeCounts();
    const body = { chunks: { c1: counts }, files: {} };

    expect(ChunkLayoutBodySchema.safeParse(body).success).toBe(false);
  });

  it.each(["x3", "c0", "c", "3c", "c01"])(
    "refuses the row run %s",
    (rowRuns) => {
      const body = { chunks: { c1: { ...makeCounts(), rowRuns } }, files: {} };

      expect(ChunkLayoutBodySchema.safeParse(body).success).toBe(false);
    },
  );

  it("refuses split widths with the wrong bucket count", () => {
    const splitLineWidths = { counts: [1, 2], overflowColumns: 0 };
    const body = {
      chunks: { c1: { ...makeCounts(), splitLineWidths } },
      files: {},
    };

    expect(ChunkLayoutBodySchema.safeParse(body).success).toBe(false);
  });

  it("refuses a body without its files section", () => {
    const body = { chunks: { c1: makeCounts() } };

    expect(ChunkLayoutBodySchema.safeParse(body).success).toBe(false);
  });

  it("refuses a file entry beyond the counts", () => {
    const body = {
      chunks: {},
      files: { "src/app.ts": { ...makeCounts(), content: "const a = 1;" } },
    };

    expect(ChunkLayoutBodySchema.safeParse(body).success).toBe(false);
  });

  it("refuses a key beyond the counts", () => {
    const body = {
      chunks: { c1: { ...makeCounts(), content: "const a = 1;" } },
      files: {},
    };

    expect(ChunkLayoutBodySchema.safeParse(body).success).toBe(false);
  });

  it("refuses a histogram with the wrong bucket count", () => {
    const counts = makeCounts();
    const lineWidths = { ...counts.lineWidths, counts: [1, 2] };
    const body = { chunks: { c1: { ...counts, lineWidths } }, files: {} };

    expect(ChunkLayoutBodySchema.safeParse(body).success).toBe(false);
  });

  it("refuses a negative count", () => {
    const body = {
      chunks: { c1: { ...makeCounts(), rows: -1 } },
      files: {},
    };

    expect(ChunkLayoutBodySchema.safeParse(body).success).toBe(false);
  });

  it("parses to the chunk-layout shapes", () => {
    expectTypeOf<
      z.output<typeof ChunkLayoutCountsSchema>
    >().toEqualTypeOf<StoredChunkLayoutCounts>();
    expectTypeOf<
      z.output<typeof ChunkLayoutBodySchema>
    >().toEqualTypeOf<ChunkLayoutBody>();
  });
});
