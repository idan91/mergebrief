/** Chrome's ceiling on a cookie's lifetime. */
export const PREFERENCE_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

/** One cookie's value out of a `document.cookie` string, absent when unset. */
export function readCookieValue(
  cookies: string,
  name: string,
): string | undefined {
  for (const pair of cookies.split(";")) {
    const separator = pair.indexOf("=");
    const namesCookie =
      separator !== -1 && pair.slice(0, separator).trim() === name;
    if (namesCookie) {
      return pair.slice(separator + 1).trim();
    }
  }
  return undefined;
}

/**
 * A view preference the server renders with: readable by script, sent on
 * every page request, never a credential.
 */
export function buildPreferenceCookie(
  name: string,
  value: string,
  secure: boolean,
): string {
  const cookie = `${name}=${value}; Path=/; Max-Age=${String(PREFERENCE_COOKIE_MAX_AGE_S)}; SameSite=Lax`;
  return secure ? `${cookie}; Secure` : cookie;
}

export function writePreferenceCookie(name: string, value: string): void {
  if (typeof document === "undefined") {
    return;
  }
  document.cookie = buildPreferenceCookie(
    name,
    value,
    window.location.protocol === "https:",
  );
}

export function clearPreferenceCookie(name: string): void {
  if (typeof document === "undefined") {
    return;
  }
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}
