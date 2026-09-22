import { LIVE_READ_PAGE_SIZE } from "github";

/** A url row read within this window is not read again. */
export const LIVE_READ_STALE_MS = 5 * 60 * 1000;

/** Pull requests per GraphQL call, GitHub's alias page. */
export const LIVE_READ_CHUNK_SIZE = LIVE_READ_PAGE_SIZE;

/** Calls per read; rows past the last chunk wait for the next read. */
export const LIVE_READ_MAX_CHUNKS = 3;

/** Row writes in flight per chunk; the chunks share the pool and queue past its ten connections. */
export const LIVE_READ_WRITE_WIDTH = 10;

/** How long a request waits for the read before serving stored rows. */
export const LIVE_READ_WAIT_MS = 2000;
