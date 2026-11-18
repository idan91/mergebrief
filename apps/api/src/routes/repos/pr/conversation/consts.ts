/** Positive TTL — same 60s staleness family as the other gated reads. */
export const CONVERSATION_CACHE_TTL_MS = 60 * 1000;
/**
 * Cap on cached conversations (keyed installation×repo×PR — reused across
 * viewers, unlike the never-reused session-keyed caches, but new PRs keep
 * arriving so the map still needs a bound).
 */
export const CONVERSATION_CACHE_MAX_ENTRIES = 2_000;
