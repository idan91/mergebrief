import type { CommittedLookupBudgetLimits, UploadQuotaLimits } from "./types";

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

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const BYTES_PER_MB = 1024 * 1024;

export const DEFAULT_UPLOAD_QUOTA_FILES = 10;
export const DEFAULT_UPLOAD_QUOTA_MB = 30;
export const DEFAULT_UPLOAD_QUOTA_WINDOW_MINUTES = 10;
export const DEFAULT_UPLOAD_QUOTA_LIMITS: UploadQuotaLimits = {
  maxFiles: DEFAULT_UPLOAD_QUOTA_FILES,
  maxBytes: DEFAULT_UPLOAD_QUOTA_MB * BYTES_PER_MB,
  windowMs: DEFAULT_UPLOAD_QUOTA_WINDOW_MINUTES * MS_PER_MINUTE,
};
/** Reviewers tracked at once; past it the longest-idle window is dropped. */
export const UPLOAD_QUOTA_MAX_ENTRIES = 10_000;
export const RETRY_AFTER_HEADER = "retry-after";

/** The Contents API's JSON answer, which names the file's `download_url`. */
export const CONTENTS_JSON_MEDIA_TYPE = "application/vnd.github+json";
/** The one host a `download_url` may name; never a host from PR text. */
export const RAW_DOWNLOAD_HOST = "raw.githubusercontent.com";
/** A raster signature fits in the first 12 bytes (WebP's tag sits at 8). */
export const RASTER_SNIFF_BYTES = 12;
/** Enough of an SVG to pass an XML prolog or a licence comment to its opening tag. */
export const SVG_SNIFF_BYTES = 4096;
export const COMMITTED_FILE_SOURCE_MAX_LENGTH = 4096;
export const COMMITTED_FILE_CACHE_MAX_ENTRIES = 500;
/** A private `download_url` carries a short-lived token; the address is kept well under its life. */
export const DOWNLOAD_URL_TTL_MS = 2 * MS_PER_MINUTE;
/** PR text sets how many links a page asks for; past this a viewer's reads answer like a missing file until the window ends. */
export const DEFAULT_COMMITTED_LOOKUP_LIMITS: CommittedLookupBudgetLimits = {
  maxLookups: 200,
  windowMs: 10 * MS_PER_MINUTE,
};
export const COMMITTED_LOOKUP_BUDGET_MAX_ENTRIES = 10_000;
