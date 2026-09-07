// A tiny bounded TTL cache. Its callers key on values that are NEVER reused
// (session token hashes are one-time-random; diff keys also vary per SHA pair),
// so a plain Map with only lazy delete-on-same-key-lookup would accumulate one
// dead entry per distinct key ever seen and never shrink. This bounds memory
// without a background timer (which would leak across tests):
//   - `get` lazily drops an expired entry;
//   - `set` sweeps expired entries once the map hits `maxEntries`, then, if it
//     is still full, evicts the OLDEST-inserted key (Map preserves insertion
//     order), so size is hard-capped independent of process uptime.
// Not an LRU (no per-read reordering) — a coarse insertion-order cap is enough
// for the short TTLs here and keeps `get` allocation-free.

export interface TtlCache<V> {
  /** The live value for `key`, or `undefined` if absent or expired. */
  get(key: string, now?: number): V | undefined;
  /** Store `value` under `key` until `expiresAt` (epoch ms). */
  set(key: string, value: V, expiresAt: number, now?: number): void;
  /** Drop `key` immediately (write-path eviction); no-op when absent. */
  delete(key: string): void;
}

interface Entry<V> {
  readonly value: V;
  readonly expiresAt: number;
}

/** Build a bounded TTL cache holding at most `maxEntries` live entries. */
export function createTtlCache<V>(maxEntries: number): TtlCache<V> {
  const entries = new Map<string, Entry<V>>();

  function sweep(now: number): void {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) {
        entries.delete(key);
      }
    }
  }

  return {
    get(key, now = Date.now()) {
      const entry = entries.get(key);
      if (entry === undefined) {
        return undefined;
      }
      if (entry.expiresAt <= now) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },

    set(key, value, expiresAt, now = Date.now()) {
      // Re-insert refreshes insertion order so the newest key isn't the first
      // eviction candidate.
      entries.delete(key);
      if (entries.size >= maxEntries) {
        sweep(now);
        if (entries.size >= maxEntries) {
          const oldest = entries.keys().next().value;
          if (oldest !== undefined) {
            entries.delete(oldest);
          }
        }
      }
      entries.set(key, { value, expiresAt });
    },

    delete(key) {
      entries.delete(key);
    },
  };
}
