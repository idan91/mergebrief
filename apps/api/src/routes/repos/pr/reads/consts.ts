import type { LargeDiffCacheLimits, SpanDiffCacheLimits } from "./types";

const MEBIBYTE = 1024 * 1024;
/** Keys are never reused, so count and bytes both bound it; the diff is live,
 * so the short TTL only debounces. */
export const SPAN_DIFF_CACHE_LIMITS = {
  maxEntryBytes: 1_000_000,
  maxBytes: 128 * MEBIBYTE,
  maxEntries: 2_000,
  ttlMs: 60 * 1000,
} as const satisfies SpanDiffCacheLimits;
/** Holds only spans pinned to two commit SHAs, whose diff never changes. */
export const LARGE_DIFF_CACHE_LIMITS = {
  maxEntryBytes: 64 * MEBIBYTE,
  maxBytes: 256 * MEBIBYTE,
  maxEntries: 256,
  maxEntriesPerViewer: 4,
  ttlMs: 10 * 60 * 1000,
} as const satisfies LargeDiffCacheLimits;
/** Attempts on a span diff stop here, inside the web tier's 30 s upstream budget. */
export const DIFF_FETCH_DEADLINE_MS = 25_000;
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
/** One entry per (session, repo); a viewer rarely has more than a few repos open. */
export const OPEN_PULLS_CACHE_MAX_ENTRIES = 200;
/** The web stack chip polls every 30s on top of this, so a stack change shows within ~40s. */
export const PR_STACK_OPEN_PULLS_CACHE_TTL_MS = 10 * 1000;
