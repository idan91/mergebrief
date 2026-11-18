import { describe, expect, it } from "vitest";
import { DiffLifetimes, type SpanDiffCacheLimits } from "../types";
import { createSpanDiffCache } from "./span-diff-cache";

const { LIVE, SHA_PINNED } = DiffLifetimes;

const LIMITS: SpanDiffCacheLimits = {
  maxEntryBytes: 8,
  maxBytes: 20,
  maxEntries: 10,
  ttlMs: 1_000,
  shaPinnedTtlMs: 5_000,
};

describe("createSpanDiffCache", () => {
  it("serves a cached diff until its time to live runs out", () => {
    const cache = createSpanDiffCache(LIMITS);
    cache.set("k", "diff", 4, 0, LIVE);

    expect(cache.get("k", 999)).toBe("diff");
    expect(cache.get("k", 1_000)).toBeUndefined();
  });

  it("keeps a SHA-pinned diff for its longer time to live", () => {
    const cache = createSpanDiffCache(LIMITS);
    cache.set("k", "diff", 4, 0, SHA_PINNED);

    expect(cache.get("k", 4_999)).toBe("diff");
    expect(cache.get("k", 5_000)).toBeUndefined();
  });

  it("refuses a diff past the per-entry byte cap and says so", () => {
    const cache = createSpanDiffCache(LIMITS);

    expect(cache.set("k", "x".repeat(9), 9, 0, LIVE)).toBe(false);
    expect(cache.get("k", 0)).toBeUndefined();
  });

  it("answers true when it holds the diff", () => {
    const cache = createSpanDiffCache(LIMITS);

    expect(cache.set("k", "x".repeat(8), 8, 0, LIVE)).toBe(true);
  });

  it("evicts the oldest diffs once their summed bytes pass the budget", () => {
    const cache = createSpanDiffCache(LIMITS);
    cache.set("a", "x".repeat(8), 8, 0, LIVE);
    cache.set("b", "y".repeat(8), 8, 0, LIVE);
    cache.set("c", "z".repeat(8), 8, 0, LIVE);

    expect(cache.get("a", 0)).toBeUndefined();
    expect(cache.get("b", 0)).toBe("y".repeat(8));
    expect(cache.get("c", 0)).toBe("z".repeat(8));
  });
});
