// A bounded TTL cache with no background timer. Callers key on values never
// reused (session hashes, SHA pairs), so a lazy-delete Map would grow for the
// process life. `get` drops an expired entry; `set` sweeps expired entries
// once the map is full or over its byte budget, then evicts the OLDEST
// inserted key until the new value fits. Not an LRU: insertion order only,
// which keeps `get` allocation-free.

export interface TtlCache<V> {
  /** The live value for `key`, or `undefined` if absent or expired. */
  get(key: string, now?: number): V | undefined;
  /** Store `value` under `key` until `expiresAt` (epoch ms). */
  set(key: string, value: V, expiresAt: number, now?: number): void;
  /** Drop `key` immediately (write-path eviction); no-op when absent. */
  delete(key: string): void;
}

/** The summed size the live entries may hold; `measureBytes` sizes one value. */
export interface TtlCacheByteBudget<V> {
  readonly maxBytes: number;
  measureBytes(value: V): number;
}

interface Entry<V> {
  readonly value: V;
  readonly expiresAt: number;
  readonly bytes: number;
}

/**
 * Build a bounded TTL cache holding at most `maxEntries` live entries and,
 * with a budget, at most `maxBytes` of them; a value past the budget is not
 * stored.
 */
export function createTtlCache<V>(
  maxEntries: number,
  byteBudget?: TtlCacheByteBudget<V>,
): TtlCache<V> {
  const entries = new Map<string, Entry<V>>();
  const maxBytes = byteBudget?.maxBytes ?? Number.POSITIVE_INFINITY;
  let totalBytes = 0;

  function remove(key: string): void {
    const entry = entries.get(key);
    if (entry !== undefined) {
      totalBytes -= entry.bytes;
      entries.delete(key);
    }
  }

  function sweep(now: number): void {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) {
        remove(key);
      }
    }
  }

  function isOverLimit(incomingBytes: number): boolean {
    const isFull = entries.size >= maxEntries;
    return isFull || totalBytes + incomingBytes > maxBytes;
  }

  function makeRoom(incomingBytes: number, now: number): void {
    if (isOverLimit(incomingBytes)) {
      sweep(now);
    }
    while (isOverLimit(incomingBytes) && entries.size > 0) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) {
        remove(oldest);
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
        remove(key);
        return undefined;
      }
      return entry.value;
    },

    set(key, value, expiresAt, now = Date.now()) {
      // Re-insert refreshes insertion order so the newest key isn't the first
      // eviction candidate.
      remove(key);
      const bytes = byteBudget?.measureBytes(value) ?? 0;
      if (bytes > maxBytes) {
        return;
      }
      makeRoom(bytes, now);
      entries.set(key, { value, expiresAt, bytes });
      totalBytes += bytes;
    },

    delete(key) {
      remove(key);
    },
  };
}
