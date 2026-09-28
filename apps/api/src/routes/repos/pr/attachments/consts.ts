/**
 * Opened directly rather than through an <img>, the response is a document
 * on this origin: the policy sandboxes it and the resource policy keeps other
 * origins from embedding it, so a type that slipped past the allowlist still
 * runs nothing.
 */
export const ATTACHMENT_RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "content-disposition": "inline",
  "content-security-policy": "default-src 'none'; sandbox",
  "cross-origin-resource-policy": "same-origin",
  "x-content-type-options": "nosniff",
} as const;

export const NO_STORE = { "cache-control": "no-store" } as const;

/** A signed private image URL lives about five minutes; the sources stay under that. */
export const SOURCES_TTL_MS = 3 * 60_000;
export const SOURCES_CACHE_MAX_ENTRIES = 200;
/** A miss inside a younger entry is answered absent rather than re-run. */
export const SOURCES_REFETCH_MIN_AGE_MS = 15_000;

export const GITHUB_API_ORIGIN = "https://api.github.com";
export const GITHUB_API_VERSION = "2022-11-28";
/** The contents endpoint answers the bytes themselves under this accept. */
export const CONTENTS_RAW_MEDIA_TYPE = "application/vnd.github.raw";
