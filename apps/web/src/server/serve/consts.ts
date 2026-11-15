/** Vite names every file under `/assets/` by its content hash. */
export const HASHED_ASSET_PREFIX = "/assets/";
export const HASHED_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const REVALIDATE_CACHE_CONTROL = "no-cache";

/** base64url characters of the content's sha256 an ETag keeps: 160 bits. */
export const ETAG_HASH_LENGTH = 27;
/** Compressed once at boot, so a slower, smaller setting than the per-request default pays. */
export const BROTLI_QUALITY = 9;
export const NOT_MODIFIED_STATUS = 304;
export const FORBIDDEN_STATUS = 403;
export const METHOD_NOT_ALLOWED_STATUS = 405;
/** How often a drain closes the keep-alive sockets that went idle. */
export const IDLE_SWEEP_MS = 250;
/** Methods fetch refuses to build a Request for; they reach nothing here. */
export const UNSERVED_METHODS: ReadonlySet<string> = new Set([
  "CONNECT",
  "TRACE",
  "TRACK",
]);

export const FALLBACK_CONTENT_TYPE = "application/octet-stream";
export const CONTENT_TYPES: ReadonlyMap<string, string> = new Map([
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/vnd.microsoft.icon"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".txt", "text/plain; charset=utf-8"],
]);
/** Fonts and images already carry their own compression. */
export const COMPRESSIBLE_TYPES: ReadonlySet<string> = new Set([
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".svg",
  ".txt",
]);
