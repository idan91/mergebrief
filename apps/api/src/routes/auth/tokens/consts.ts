/** Entropy for the opaque token (bytes) — same budget as the session cookie. */
export const TOKEN_BYTES = 32;
/** Default expiry when the mint names none. */
export const DEFAULT_EXPIRY_DAYS = 90;
/** Upper bound on a chosen expiry — 10 years; beyond that, use no-expiry. */
export const MAX_EXPIRY_DAYS = 3650;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;
