/**
 * Positive-cache TTL: short enough that a revoked grant self-heals fast. The
 * per-session allowed-repo-set cache deliberately shares this constant.
 */
export const AUTHZ_CACHE_TTL_MS = 60 * 1000;

/**
 * Hard cap on live positive-cache entries (one per session×repo). Session
 * hashes are one-time-random, so keys are never reused and would otherwise
 * accumulate for the process lifetime; the oldest entry is evicted past it.
 */
export const POSITIVE_CACHE_MAX_ENTRIES = 50_000;

/** The gate's mount param and the per-PR subtree's segment after it. */
export const REPO_ID_PARAM = ":repoId";
export const PULLS_SEGMENT = "pulls";

/** `Authorization` scheme + the opaque token's secret-scanner-friendly prefix. */
export const BEARER_SCHEME = "Bearer ";
export const API_TOKEN_PREFIX = "mergebrief_";

/** `last_used_at` is visibility metadata, one write per token per window. */
export const TOKEN_TOUCH_THROTTLE_MS = 60 * 1000;
/** Bounded like the positive cache: token hashes are long-lived but finite. */
export const TOUCH_THROTTLE_MAX_ENTRIES = 50_000;
