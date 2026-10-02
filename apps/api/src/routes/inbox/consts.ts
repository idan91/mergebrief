/** The Inbox's whole live ceiling: the url rows read first, the open lists get what is left. */
export const INBOX_LIVE_BUDGET_MS = 2_500;
/** Open lists read at once; the rest queue behind the first to finish. */
export const INBOX_STACKS_CONCURRENCY = 3;
/** One entry per (session, repo): a page names at most 25 repos, a viewer a handful of sessions. */
export const INBOX_OPEN_PULLS_CACHE_MAX_ENTRIES = 500;
/** Per-session open-PR list TTL for Inbox stacks: a row's stack line tolerates a minute stale. */
export const INBOX_OPEN_PULLS_CACHE_TTL_MS = 60 * 1000;
