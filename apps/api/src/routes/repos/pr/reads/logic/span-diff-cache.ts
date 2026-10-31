import { createTtlCache } from "../../../../ttl-cache";
import {
  DiffLifetimes,
  type SizedDiff,
  type SpanDiffCache,
  type SpanDiffCacheLimits,
} from "../types";
import { readSizedBytes } from "./held-bytes";

/** A TTL cache bounded by entry count and by the summed bytes it holds. */
export function createSpanDiffCache(
  limits: SpanDiffCacheLimits,
): SpanDiffCache {
  const diffs = createTtlCache<SizedDiff>(limits.maxEntries, {
    maxBytes: limits.maxBytes,
    measureBytes: readSizedBytes,
  });

  return {
    get(key, now) {
      return diffs.get(key, now)?.diff;
    },

    set(key, diff, bytes, now, lifetime) {
      if (bytes > limits.maxEntryBytes) {
        return false;
      }
      const ttlMs =
        lifetime === DiffLifetimes.SHA_PINNED
          ? limits.shaPinnedTtlMs
          : limits.ttlMs;
      diffs.set(key, { diff, bytes }, now + ttlMs, now);
      return true;
    },
  };
}
