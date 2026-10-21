// Bounded TTL cache. Guards the memory-bound behavior the
// authz + diff caches rely on: expiry drops entries, and the hard cap evicts
// the oldest so never-reused keys can't grow the map without bound.
import { describe, expect, it } from "vitest";
import { createTtlCache } from "../src/routes/ttl-cache";

describe("createTtlCache", () => {
  it("returns a live value and drops it once expired", () => {
    const cache = createTtlCache<string>(10);
    cache.set("k", "v", 1000, 0);
    expect(cache.get("k", 999)).toBe("v");
    expect(cache.get("k", 1000)).toBeUndefined(); // expiresAt is exclusive
    // Lazily deleted on the expired read → a later read is also undefined.
    expect(cache.get("k", 500)).toBeUndefined();
  });

  it("evicts the oldest entry once past the cap", () => {
    const cache = createTtlCache<number>(2);
    const far = 1_000_000;
    cache.set("a", 1, far, 0);
    cache.set("b", 2, far, 0);
    cache.set("c", 3, far, 0); // over cap → "a" (oldest, still live) evicted
    expect(cache.get("a", 0)).toBeUndefined();
    expect(cache.get("b", 0)).toBe(2);
    expect(cache.get("c", 0)).toBe(3);
  });

  it("prefers sweeping expired entries over evicting a live one", () => {
    const cache = createTtlCache<number>(2);
    cache.set("expired", 1, 100, 0); // will be expired by the time we push past cap
    cache.set("live", 2, 1_000_000, 0);
    cache.set("new", 3, 1_000_000, 200); // at now=200 the sweep reclaims "expired"
    expect(cache.get("expired", 200)).toBeUndefined();
    expect(cache.get("live", 200)).toBe(2); // survived: a dead entry was reclaimed instead
    expect(cache.get("new", 200)).toBe(3);
  });

  it("re-inserting a key refreshes its recency", () => {
    const cache = createTtlCache<number>(2);
    const far = 1_000_000;
    cache.set("a", 1, far, 0);
    cache.set("b", 2, far, 0);
    cache.set("a", 10, far, 0); // a becomes newest
    cache.set("c", 3, far, 0); // over cap → oldest is now "b"
    expect(cache.get("b", 0)).toBeUndefined();
    expect(cache.get("a", 0)).toBe(10);
    expect(cache.get("c", 0)).toBe(3);
  });
});

describe("delete", () => {
  it("removes a live entry so the next get misses", () => {
    const cache = createTtlCache<string>(10);
    cache.set("k", "v", Date.now() + 60_000);
    expect(cache.get("k")).toBe("v");
    cache.delete("k");
    expect(cache.get("k")).toBeUndefined();
  });
});
