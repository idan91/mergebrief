// The web tier's upstream budgets. Plain values, no server-only marker: the
// production listener (`src/serve.ts`) reads the submit budget as its drain.

/**
 * Upstream budget for one API request. Long enough for a cold read behind the
 * gate, short enough that a stuck upstream frees the web tier's socket rather
 * than holding a render open until the browser gives up.
 */
export const UPSTREAM_TIMEOUT_MS = 30_000;
// The API posts one GitHub mutation per draft, each at least one second
// (octokit's write pacing) plus GitHub's own latency, so a submit at the
// 64-draft session cap runs ~66 s; the budget allows about 2 s per mutation
// sustained.
export const SUBMIT_TIMEOUT_MS = 150_000;
// The browser gives an upload 120 s; the hop's budget sits above it so the
// browser's own timeout, not a proxy 504, is what the reviewer sees.
export const UPLOAD_TIMEOUT_MS = 150_000;
