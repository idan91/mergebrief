import { describe, expect, it } from "vitest";
import type { LargeDiffCacheLimits } from "../types";
import { measureHeldBytes } from "./held-bytes";
import { createLargeDiffCache } from "./large-diff-cache";

const LIMITS: LargeDiffCacheLimits = {
  maxEntryBytes: 8,
  maxBytes: 20,
  maxEntries: 10,
  maxEntriesPerViewer: 2,
  ttlMs: 1_000,
};

describe("createLargeDiffCache", () => {
  it("serves a cached diff until its time to live runs out", () => {
    const cache = createLargeDiffCache(LIMITS);
    cache.set("viewer", "k", "diff", measureHeldBytes("diff"), 0);

    expect(cache.get("k", 999)).toBe("diff");
    expect(cache.get("k", 1_000)).toBeUndefined();
  });

  it("refuses a diff past the per-entry byte cap", () => {
    const cache = createLargeDiffCache(LIMITS);
    cache.set("viewer", "k", "x".repeat(9), measureHeldBytes("x".repeat(9)), 0);

    expect(cache.get("k", 0)).toBeUndefined();
  });

  it("keeps a viewer's newest entries past their per-viewer cap", () => {
    const cache = createLargeDiffCache(LIMITS);
    cache.set("viewer", "a", "aa", measureHeldBytes("aa"), 0);
    cache.set("viewer", "b", "bb", measureHeldBytes("bb"), 0);
    cache.set("other", "c", "cc", measureHeldBytes("cc"), 0);
    cache.set("viewer", "d", "dd", measureHeldBytes("dd"), 0);

    expect(cache.get("a", 0)).toBeUndefined();
    expect(cache.get("b", 0)).toBe("bb");
    expect(cache.get("c", 0)).toBe("cc");
    expect(cache.get("d", 0)).toBe("dd");
  });

  it("evicts the oldest entry across viewers past the byte cap", () => {
    const cache = createLargeDiffCache(LIMITS);
    cache.set("one", "a", "x".repeat(8), measureHeldBytes("x".repeat(8)), 0);
    cache.set("two", "b", "x".repeat(8), measureHeldBytes("x".repeat(8)), 0);
    cache.set("three", "c", "x".repeat(8), measureHeldBytes("x".repeat(8)), 0);

    expect(cache.get("a", 0)).toBeUndefined();
    expect(cache.get("b", 0)).toBe("x".repeat(8));
    expect(cache.get("c", 0)).toBe("x".repeat(8));
  });

  it("frees a viewer's slot once its entry expires", () => {
    const cache = createLargeDiffCache(LIMITS);
    cache.set("viewer", "a", "aa", measureHeldBytes("aa"), 0);
    cache.set("viewer", "b", "bb", measureHeldBytes("bb"), 500);
    cache.set("viewer", "c", "cc", measureHeldBytes("cc"), 1_200);

    expect(cache.get("b", 1_200)).toBe("bb");
    expect(cache.get("c", 1_200)).toBe("cc");
  });
});
