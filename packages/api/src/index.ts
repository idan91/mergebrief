// Package entry point — the whole public surface (BRIEF-2 stage 4). The app
// factory is the only export: consumers (the `apps/web` catch-all mount,
// stage 5) build deps and hand them in; routes are internal wiring.
export { createApp } from "./app";
export type { ApiApp, AppDeps, AuthDeps } from "./app";
// Generate-from-URL port (BRIEF-97): the web composition root implements
// UrlBriefEngine; the error vocabulary is part of the port contract.
export { UrlBriefErrorKind } from "./routes/generate";
export type {
  GeneratedBriefRef,
  UrlBriefEngine,
  UrlBriefError,
} from "./routes/generate";

// The installation-octokit seam (BRIEF-25; widened by BRIEF-94 with the
// collaborators read): the composition root wires `appInstallationPort` over
// the App-JWT client; tests substitute the port.
export { appInstallationPort } from "./routes/github-port";
export type { InstallationGitHubPort } from "./routes/github-port";

// The serialized token-refresh orchestrator (BRIEF-2 stage 6, D11): built +
// tested here, called by stage 7's authz middleware on a GitHub 401.
export {
  principalFromApiToken,
  principalFromSession,
  refreshSessionToken,
  RefreshErrorCode,
} from "./routes/auth";
export type { RefreshError, RefreshedSession, AuthRouteDeps } from "./routes/auth";

// The PR-meta `comparisons.lastReview` response vocabulary and view shape
// (BRIEF-21). Exported for the sole benefit of consumers that MIRROR this
// contract: `apps/web` hand-rolls its own wire types, and its lockstep drift
// pins assert against this source rather than a literal copy (BRIEF-44 PR 7) —
// no route behavior depends on the re-export. One name, both meanings: the
// first line carries the const map AND the same-named value union.
export { LastReviewUnavailableReason } from "./routes/reads";
export type { LastReviewComparisonView } from "./routes/reads";

// Queue schema bootstrap — install/upgrade the `graphile_worker` schema so the
// webhook's by-name `add_job` enqueue works against real Postgres. Composition
// roots call this once at startup; BRIEF-2 installs only (worker = BRIEF-3).
export { migrateQueue } from "./queue";
