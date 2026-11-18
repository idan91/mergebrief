/** The example pull request, as the demo's answers identify it. The repository id is made up. */
export const DEMO_PR = {
  repoId: "424242",
  repoSlug: "idan91/mergebrief",
  prNumber: 625,
  authorLogin: "idan91",
  installationId: "7001",
  installationAccount: "idan91",
} as const;

/** The brief's address inside the demo, and where the demo opens. */
export const DEMO_PR_PATH = `/repos/${DEMO_PR.repoId}/pulls/${String(DEMO_PR.prNumber)}`;

export const DEMO_VIEWER_LOGIN = "demo-reviewer";

export const DEMO_VERSION = "0.1.0";

/** A made-up colleague: the person whose review the demo's conversation holds. */
export const DEMO_REVIEWER_LOGIN = "mira-k";

/** Auth bootstrap paths sit outside the operation table. */
export const AUTH_SESSION_PATH = "/api/auth/session";
export const AUTH_LOGOUT_PATH = "/api/auth/logout";
export const VERSION_PATH = "/api/version";
export const API_PATH_PREFIX = "/api/";

/** Relative paths resolve against this; only the path and query are read. */
export const DEMO_URL_BASE = "http://demo.local";

export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
export const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";
