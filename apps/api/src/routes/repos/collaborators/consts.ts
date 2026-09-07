/** Positive TTL — same 60s staleness family as the other gated reads. */
export const COLLABORATORS_CACHE_TTL_MS = 60 * 1000;
/** One entry per installation×repo — far fewer keys than the per-PR caches. */
export const COLLABORATORS_CACHE_MAX_ENTRIES = 2_000;
