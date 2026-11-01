export const GITHUB_ORIGIN = "https://github.com";
export const GITHUB_HOST = "github.com";
export const RAW_CONTENT_HOST = "raw.githubusercontent.com";

/** `blob/<ref>/<path>` is the file's page; only this exact query makes it the bytes. */
export const BLOB_RAW_QUERY = "?raw=true";
export const RAW_PATH_MODE = "raw";
export const BLOB_PATH_MODE = "blob";

/** The decoded ref and path together; past it no real address reaches. */
export const COMMITTED_FILE_PATH_MAX_LENGTH = 1024;
/** A ref and at least one path segment. */
export const MIN_PATH_SEGMENTS = 2;
/** The first segment of a fully qualified ref. */
export const QUALIFIED_REF_ROOT = "refs";
