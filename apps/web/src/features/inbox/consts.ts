/** The first segment of every Inbox query key; invalidating it re-reads the list. */
export const INBOX_QUERY_ROOT = "inbox";

/** A pending or running row re-reads its status at the Brief page's cadence. */
export const ROW_POLL_MS = 4_000;

/** The last staggered row has landed by now; the arming attribute leaves after it. */
export const FIRST_LOAD_SETTLE_MS = 720;
