import { FIXTURE_PR_TITLE } from "../../../e2e/fixtures/ids";

/** The fixture set's one pull request, as the seeded database identifies it. */
export const DEMO_PR = {
  repoId: "424242",
  repoSlug: "mergebrief/e2e-fixture",
  prNumber: 1,
  title: FIXTURE_PR_TITLE,
  authorLogin: "e2e-author",
  installationId: "7001",
  installationAccount: "mergebrief",
} as const;

export const DEMO_VIEWER_LOGIN = "demo-reviewer";

export const DEMO_VERSION = "0.1.0";

/** The thread author the committed fixture comments already name. */
export const FIXTURE_REVIEWER_LOGIN = "fixture-reviewer";

/** Auth bootstrap paths sit outside the operation table. */
export const AUTH_SESSION_PATH = "/api/auth/session";
export const AUTH_LOGOUT_PATH = "/api/auth/logout";
export const VERSION_PATH = "/api/version";
export const API_PATH_PREFIX = "/api/";

/** Relative paths resolve against this; only the path and query are read. */
export const DEMO_URL_BASE = "http://demo.local";

export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
export const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";
