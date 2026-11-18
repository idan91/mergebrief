import type {
  CommittedLookupBudgetLimits,
  StreamWindow,
  UploadQuotaLimits,
} from "./types";

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

/** One media reply carries at most this much; the browser asks for the next piece itself. */
export const MEDIA_PIECE_BYTES = 4 * BYTES_PER_MB;
/** Open media streams one API process serves at once; past it a read answers 503. */
export const MAX_OPEN_MEDIA_STREAMS = 64;
export const DEFAULT_MEDIA_MAX_MB = 100;
/**
 * A piece's whole life once its permit is held. A 4 MiB piece needs about
 * 1.1 Mbit/s to finish inside it; a player that paused or reads slower loses
 * the rest of the piece and asks the next range from where it stopped.
 */
export const MEDIA_PIECE_DEADLINE_MS = 30 * MS_PER_SECOND;
/**
 * The pace a piece needs to finish inside its deadline. A whole image is one
 * request an img never resumes, so its deadline is the time its bytes take at
 * this pace, never under a piece's.
 */
export const MEDIA_FLOOR_BYTES_PER_MS =
  MEDIA_PIECE_BYTES / MEDIA_PIECE_DEADLINE_MS;
/** The upstream's headers must arrive inside this; its body then streams at the reader's pace. */
export const UPSTREAM_HEADERS_TIMEOUT_MS = 15 * MS_PER_SECOND;
/** A GitHub JSON answer, headers and body, must arrive inside this. */
export const GITHUB_JSON_TIMEOUT_MS = 15 * MS_PER_SECOND;
/** Enough of a video to reach an mp4's brand or a WebM's doc type. */
export const VIDEO_SNIFF_BYTES = 64;
/** A piece starting inside this many bytes is read from byte zero, so its signature is checked. */
export const MEDIA_SNIFF_WINDOW_BYTES = Math.max(
  RASTER_SNIFF_BYTES,
  SVG_SNIFF_BYTES,
  VIDEO_SNIFF_BYTES,
);
export const ACCEPT_RANGES_BYTES = "bytes";

/** Twice the strip's tile box (248x78), so a thumbnail stays sharp on a 2x screen. */
export const THUMBNAIL_MAX_WIDTH = 496;
export const THUMBNAIL_MAX_HEIGHT = 156;
export const THUMBNAIL_WEBP_QUALITY = 80;
/** Resizes one API process runs at once; a request past it waits for a turn. */
export const MAX_RUNNING_RESIZES = 4;
export const RESIZE_TURN_WAIT_MS = 10 * MS_PER_SECOND;
/** Thumbnail requests one API process lets wait for a turn; past it a request answers busy at once. */
export const MAX_WAITING_RESIZES = 64;
/** Checked on the header before any decode: at 4 bytes a pixel, four resizes stay under 640 MB; 8K (33 MP) fits. */
export const THUMBNAIL_MAX_INPUT_PIXELS = 40_000_000;
/** sharp's own limit on one resize, so a slow decode inside the pixel limit still frees its turn. */
export const RESIZE_TIMEOUT_SECONDS = 10;
/** The largest original a thumbnail buffers, or the media cap when lower. */
export const THUMBNAIL_SOURCE_MAX_BYTES = 20 * BYTES_PER_MB;
/** One thumbnail's whole life, from the upstream request to its last byte read; inside the web tier's 30 s. */
export const THUMBNAIL_DEADLINE_MS = 25 * MS_PER_SECOND;
/** Asked of every bytes fetch, so a length upstream names is the length served. */
export const IDENTITY_CODING = "identity";
/** A whole-file reply: every byte of the upstream answer, from its first. */
export const WHOLE_FILE_WINDOW: StreamWindow = { skip: 0 };
