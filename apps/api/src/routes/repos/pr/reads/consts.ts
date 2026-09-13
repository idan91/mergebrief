/** Per-session diff cache TTL: short; the diff is live, this only debounces. */
export const DIFF_CACHE_TTL_MS = 60 * 1000;
/** Keys are never reused, so an uncapped Map would grow for the process life. */
export const DIFF_CACHE_MAX_ENTRIES = 2_000;
/** The entry-count cap alone doesn't bound bytes; an oversized diff is served
 * but NOT cached. */
export const DIFF_CACHE_MAX_ENTRY_BYTES = 1_000_000;
/** The expander steps 20 lines per click and caps its own "expand all", so
 * this refuses draining a 100k-line file without refusing an honest ask. */
export const MAX_FILE_RANGE_LINES = 400;
/** Fetch cap, and the never-cache threshold: a blob past it is refused rather
 * than served uncached, which would re-fetch the whole file per hunk edge. */
export const FILE_BLOB_MAX_BYTES = 1_000_000;
export const FILE_BLOB_CACHE_TTL_MS = 60 * 1000;
/** A count, not a byte bound. Entries are split lines, one V8 string each, so
 * a 1 MB file of short lines resides well above 1 MB; 64 x
 * `FILE_BLOB_MAX_BYTES` is the SOURCE bytes a reader can pin, and heap runs
 * some multiple of that. Sized to hold every file of a large review while
 * sweeping only on write. */
export const FILE_BLOB_CACHE_MAX_ENTRIES = 64;
