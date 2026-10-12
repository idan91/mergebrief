// Browser-only: `apiFetch`'s client branch is the one caller.
export const SIGN_IN_PATH = "/api/auth/github";

const SIGN_IN_REQUESTED_KEY = "mergebrief.signInRequestedAt";
/**
 * Longer than an OAuth round trip on an app already authorized, so a sign-in
 * that comes back still refused stays on the page's own sign-in copy instead
 * of leaving again.
 */
const SIGN_IN_COOLDOWN_MS = 2 * 60_000;

/** This page's mark when local storage is denied. */
let requestedAtInMemory: number | undefined;

function readRequestedAt(): number | undefined {
  try {
    const stored = window.localStorage.getItem(SIGN_IN_REQUESTED_KEY);
    if (stored === null) {
      return undefined;
    }
    const requestedAt = Number(stored);
    return Number.isFinite(requestedAt) ? requestedAt : undefined;
  } catch {
    return requestedAtInMemory;
  }
}

function writeRequestedAt(requestedAt: number): void {
  try {
    window.localStorage.setItem(SIGN_IN_REQUESTED_KEY, String(requestedAt));
  } catch {
    requestedAtInMemory = requestedAt;
  }
}

/**
 * Sends the browser to GitHub sign-in, once per cooldown across the browser's
 * tabs: the API keeps one OAuth state cookie per host, so a second tab
 * starting its own flow would fail the first one's callback. A burst of
 * refusals leaves once, and a refusal right after a sign-in never loops.
 */
export function requestSignIn(): void {
  const now = Date.now();
  const requestedAt = readRequestedAt();
  // A mark from the future (a clock set back) never holds sign-in off.
  const elapsedMs = requestedAt === undefined ? -1 : now - requestedAt;
  const coolingDown = elapsedMs >= 0 && elapsedMs < SIGN_IN_COOLDOWN_MS;
  if (coolingDown) {
    return;
  }

  writeRequestedAt(now);
  window.location.assign(SIGN_IN_PATH);
}
