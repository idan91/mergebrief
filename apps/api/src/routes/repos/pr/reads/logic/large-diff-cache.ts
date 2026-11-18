import { createTtlCache } from "../../../../ttl-cache";
import type { LargeDiffCache, LargeDiffCacheLimits, SizedDiff } from "../types";
import { readSizedBytes } from "./held-bytes";

/**
 * A byte-budgeted TTL cache plus each viewer's keys in insertion order. Every
 * write first drops the keys the cache no longer holds, so the viewer map
 * never outgrows the live entries.
 */
export function createLargeDiffCache(
  limits: LargeDiffCacheLimits,
): LargeDiffCache {
  const diffs = createTtlCache<SizedDiff>(limits.maxEntries, {
    maxBytes: limits.maxBytes,
    measureBytes: readSizedBytes,
  });
  const keysByViewer = new Map<string, string[]>();

  function pruneViewers(now: number): void {
    for (const [viewer, keys] of keysByViewer) {
      const live = keys.filter((key) => diffs.get(key, now) !== undefined);
      if (live.length === 0) {
        keysByViewer.delete(viewer);
      } else {
        keysByViewer.set(viewer, live);
      }
    }
  }

  return {
    get(key, now) {
      return diffs.get(key, now)?.diff;
    },

    set(viewer, key, diff, bytes, now) {
      if (bytes > limits.maxEntryBytes) {
        return;
      }
      pruneViewers(now);

      const keys = (keysByViewer.get(viewer) ?? []).filter(
        (held) => held !== key,
      );
      while (keys.length >= limits.maxEntriesPerViewer) {
        const oldest = keys.shift();
        if (oldest !== undefined) {
          diffs.delete(oldest);
        }
      }
      diffs.set(key, { diff, bytes }, now + limits.shaPinnedTtlMs, now);
      keys.push(key);
      keysByViewer.set(viewer, keys);
    },
  };
}
