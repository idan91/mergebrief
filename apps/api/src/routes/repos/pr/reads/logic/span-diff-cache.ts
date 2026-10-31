import { createTtlCache } from "../../../../ttl-cache";
import type { SizedDiff, SpanDiffCache, SpanDiffCacheLimits } from "../types";
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

    set(key, diff, bytes, now) {
      if (bytes > limits.maxEntryBytes) {
        return;
      }
      diffs.set(key, { diff, bytes }, now + limits.ttlMs, now);
    },
  };
}
