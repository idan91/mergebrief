import { LINE_DIFF_TIMEOUT_MS } from "brief-core/pr-span";

/** Covers a cold start: the thread loads its module through tsx before it diffs. */
const THREAD_START_ALLOWANCE_MS = 5_000;

/** A thread that has not answered one diff by now is stuck, not slow: jsdiff stops itself at its own limit. */
export const THREAD_ANSWER_LIMIT_MS =
  LINE_DIFF_TIMEOUT_MS + THREAD_START_ALLOWANCE_MS;

export const THREAD_RESPAWN_BACKOFF_MS = 1_000;

export const MAX_THREAD_RESPAWN_BACKOFF_MS = 30_000;

/** Stops in a row a restart takes at once; from this many on, it waits the backoff. */
export const STOPS_BEFORE_RESPAWN_BACKOFF = 2;
