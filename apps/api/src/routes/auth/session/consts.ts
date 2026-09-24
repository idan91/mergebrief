/**
 * The session cookie name, `__Host-` prefixed: the browser refuses it without
 * `Secure`, with a `Domain` attribute, or off `Path=/`, so a sibling subdomain
 * on the same apex cannot shadow it. Exported so the authz middleware reads
 * the SAME cookie the oauth route sets, rather than re-declaring the string.
 */
export const SESSION_COOKIE = "__Host-mergebrief_session";

/** The attributes the `__Host-` prefix requires, plus the ones both cookies share. */
export const HOST_COOKIE_ATTRIBUTES = {
  httpOnly: true,
  sameSite: "Lax",
  secure: true,
  path: "/",
} as const;

/** A `__Host-` clear must carry `Secure` and `Path=/` too, or the browser ignores it. */
export const HOST_COOKIE_CLEAR = { path: "/", secure: true } as const;
