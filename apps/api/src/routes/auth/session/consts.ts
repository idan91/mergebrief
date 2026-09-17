/**
 * The session cookie name. Exported so the authz middleware reads the SAME
 * cookie the oauth route sets, rather than re-declaring the string.
 */
export const SESSION_COOKIE = "rs_session";
