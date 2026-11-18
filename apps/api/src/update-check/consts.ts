export const DEFAULT_UPDATE_CHECK_URL =
  "https://github.com/idan91/mergebrief/releases/latest/download/version.json";

export const BOOT_DELAY_MS = 60 * 1000;

/** A signed-in read past this age kicks one background fetch; the stale snapshot still answers. */
export const MAX_SNAPSHOT_AGE_MS = 60 * 60 * 1000;

export const FETCH_TIMEOUT_MS = 10 * 1000;

/** A body past this many bytes is cancelled unread. */
export const MAX_MANIFEST_BYTES = 64 * 1024;

/** Versions the check never compares or warns about. */
export const DEV_VERSIONS: ReadonlySet<string> = new Set(["dev", "0.0.0"]);
