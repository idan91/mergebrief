/** Same 60s staleness family as the other gated reads. */
export const MENTIONS_CACHE_TTL_MS = 60 * 1000;
/** One entry per viewer, repo and typed text; typing churns through keys. */
export const MENTIONS_CACHE_MAX_ENTRIES = 5_000;
