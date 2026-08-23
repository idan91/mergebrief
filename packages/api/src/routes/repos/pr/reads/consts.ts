/** Per-session diff cache TTL — short; the diff is live, this only debounces. */
export const DIFF_CACHE_TTL_MS = 60 * 1000;
/**
 * Hard cap on cached diffs. Keys are never reused (fresh session hash + new
 * SHA pair per push), so an uncapped Map would grow for the process lifetime;
 * the oldest entry is evicted past the cap.
 */
export const DIFF_CACHE_MAX_ENTRIES = 2_000;
/**
 * Per-entry byte cap: the entry-count cap alone doesn't bound bytes, so an
 * oversized diff (cheap to re-proxy) is served but NOT cached.
 */
export const DIFF_CACHE_MAX_ENTRY_BYTES = 1_000_000;
