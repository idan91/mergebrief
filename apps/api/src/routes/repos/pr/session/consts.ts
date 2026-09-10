/**
 * How many unposted drafts one session may hold. It bounds what a single
 * submit posts to GitHub, so it belongs to the session rather than to any
 * one request: the 65th is refused when it is written, not at submit,
 * where the reviewer would have nowhere to put it.
 */
export const MAX_SESSION_DRAFTS = 64;
