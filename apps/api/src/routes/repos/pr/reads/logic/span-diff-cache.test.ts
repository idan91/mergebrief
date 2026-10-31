import { describe, expect, it } from "vitest";
import type { SpanDiffCacheLimits } from "../types";
import { createSpanDiffCache } from "./span-diff-cache";

const LIMITS: SpanDiffCacheLimits = {
  maxEntryBytes: 8,
  maxBytes: 20,
  maxEntries: 10,
  ttlMs: 1_000,
};

describe("createSpanDiffCache", () => {
  it("serves a cached diff until its time to live runs out", () => {
    const cache = createSpanDiffCache(LIMITS);
    cache.set("k", "diff", 4, 0);

    expect(cache.get("k", 999)).toBe("diff");
    expect(cache.get("k", 1_000)).toBeUndefined();
  });

  it("refuses a diff past the per-entry byte cap", () => {
    const cache = createSpanDiffCache(LIMITS);
    cache.set("k", "x".repeat(9), 9, 0);

    expect(cache.get("k", 0)).toBeUndefined();
  });

  it("evicts the oldest diffs once their summed bytes pass the budget", () => {
    const cache = createSpanDiffCache(LIMITS);
    cache.set("a", "x".repeat(8), 8, 0);
    cache.set("b", "y".repeat(8), 8, 0);
    cache.set("c", "z".repeat(8), 8, 0);

    expect(cache.get("a", 0)).toBeUndefined();
    expect(cache.get("b", 0)).toBe("y".repeat(8));
    expect(cache.get("c", 0)).toBe("z".repeat(8));
  });
});
