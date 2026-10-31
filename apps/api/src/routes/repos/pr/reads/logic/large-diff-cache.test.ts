import { describe, expect, it } from "vitest";
import { DiffLifetimes, type LargeDiffCacheLimits } from "../types";
import { measureHeldBytes } from "./held-bytes";
import { createLargeDiffCache } from "./large-diff-cache";

const { LIVE, SHA_PINNED } = DiffLifetimes;

const LIMITS: LargeDiffCacheLimits = {
  maxEntryBytes: 8,
  maxBytes: 20,
  maxEntries: 10,
  maxEntriesPerViewer: 2,
  ttlMs: 1_000,
  shaPinnedTtlMs: 5_000,
};

describe("createLargeDiffCache", () => {
  it("serves a cached diff until its time to live runs out", () => {
    const cache = createLargeDiffCache(LIMITS);
    cache.set("viewer", "k", "diff", measureHeldBytes("diff"), 0, LIVE);

    expect(cache.get("k", 999)).toBe("diff");
    expect(cache.get("k", 1_000)).toBeUndefined();
  });

  it("keeps a SHA-pinned diff for its longer time to live", () => {
    const cache = createLargeDiffCache(LIMITS);
    cache.set("viewer", "k", "diff", measureHeldBytes("diff"), 0, SHA_PINNED);

    expect(cache.get("k", 4_999)).toBe("diff");
    expect(cache.get("k", 5_000)).toBeUndefined();
  });

  it("refuses a diff past the per-entry byte cap", () => {
    const cache = createLargeDiffCache(LIMITS);
    cache.set(
      "viewer",
      "k",
      "x".repeat(9),
      measureHeldBytes("x".repeat(9)),
      0,
      LIVE,
    );

    expect(cache.get("k", 0)).toBeUndefined();
  });

  it("keeps a viewer's newest entries past their per-viewer cap", () => {
    const cache = createLargeDiffCache(LIMITS);
    cache.set("viewer", "a", "aa", measureHeldBytes("aa"), 0, LIVE);
    cache.set("viewer", "b", "bb", measureHeldBytes("bb"), 0, LIVE);
    cache.set("other", "c", "cc", measureHeldBytes("cc"), 0, LIVE);
    cache.set("viewer", "d", "dd", measureHeldBytes("dd"), 0, LIVE);

    expect(cache.get("a", 0)).toBeUndefined();
    expect(cache.get("b", 0)).toBe("bb");
    expect(cache.get("c", 0)).toBe("cc");
    expect(cache.get("d", 0)).toBe("dd");
  });

  it("evicts the oldest entry across viewers past the byte cap", () => {
    const cache = createLargeDiffCache(LIMITS);
    cache.set(
      "one",
      "a",
      "x".repeat(8),
      measureHeldBytes("x".repeat(8)),
      0,
      LIVE,
    );
    cache.set(
      "two",
      "b",
      "x".repeat(8),
      measureHeldBytes("x".repeat(8)),
      0,
      LIVE,
    );
    cache.set(
      "three",
      "c",
      "x".repeat(8),
      measureHeldBytes("x".repeat(8)),
      0,
      LIVE,
    );

    expect(cache.get("a", 0)).toBeUndefined();
    expect(cache.get("b", 0)).toBe("x".repeat(8));
    expect(cache.get("c", 0)).toBe("x".repeat(8));
  });

  it("frees a viewer's slot once its entry expires", () => {
    const cache = createLargeDiffCache(LIMITS);
    cache.set("viewer", "a", "aa", measureHeldBytes("aa"), 0, LIVE);
    cache.set("viewer", "b", "bb", measureHeldBytes("bb"), 500, LIVE);
    cache.set("viewer", "c", "cc", measureHeldBytes("cc"), 1_200, LIVE);

    expect(cache.get("b", 1_200)).toBe("bb");
    expect(cache.get("c", 1_200)).toBe("cc");
  });
});
