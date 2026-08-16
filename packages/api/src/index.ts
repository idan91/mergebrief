// Package entry point — routes are internal wiring, never exported.
export { createApp } from "./app";
export type { ApiApp, AppDeps, AuthDeps } from "./app";
// Generate-from-URL port: the error vocabulary is part of the port contract.
export { UrlBriefErrorKind } from "./routes/generate";
export type {
  GeneratedBriefRef,
  UrlBriefEngine,
  UrlBriefError,
} from "./routes/generate";

// The startup wiring wires `appInstallationPort` over the App-JWT client;
// tests substitute the port.
export { appInstallationPort } from "./routes/github-port";
export type { InstallationGitHubPort } from "./routes/github-port";

// The serialized token-refresh orchestrator: called by the authz middleware
// on a GitHub 401.
export {
  principalFromApiToken,
  principalFromSession,
  refreshSessionToken,
  RefreshErrorCode,
} from "./routes/auth/session";
export type {
  RefreshError,
  RefreshedSession,
  AuthRouteDeps,
} from "./routes/auth/session";

// Exported only for consumers that MIRROR this contract: `apps/web` hand-rolls
// its own wire types and its drift pins assert against this source. No route
// behavior depends on the re-export.
export { LastReviewUnavailableReason } from "./routes/repos/pr/reads";
export type { LastReviewComparisonView } from "./routes/repos/pr/reads";

// The wire error contract. `API_ERROR_ENGLISH`/`API_ERROR_STATUS` are
// mirror-only: `packages/i18n` pins `errors.<code>` templates against them;
// `apps/web` pins its hand-rolled code mirror. No route behavior may depend
// on these exports.
export {
  API_ERROR_ENGLISH,
  API_ERROR_STATUS,
  ApiErrorCode,
} from "./error-response";
export type { ApiErrorBody, ApiErrorParams } from "./error-response";

// Installs/upgrades the `graphile_worker` schema so the webhook's by-name
// `add_job` enqueue works against real Postgres. Composition roots call this
// once at startup.
export { migrateQueue } from "./queue";
