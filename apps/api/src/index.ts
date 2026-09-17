// Package entry point, routes are internal wiring, never exported.
export { createApp } from "./app";
export type { ApiApp, AppDeps, AuthDeps } from "./app";
// The audit knobs the composition root reads from persistence config.
export type { AuditEmitConfig } from "./product-operations/audit";
// The startup wiring wires `appInstallationPort` over the App-JWT client;
// tests substitute the port.
export { appInstallationPort } from "./routes/github-port";
export type { InstallationGitHubPort } from "./routes/github-port";

// The serialized token-refresh orchestrator: called by the authz middleware
// on a GitHub 401.
export { RefreshErrorCodes } from "./routes/auth/session/types";
export {
  derivePrincipalFromApiToken,
  derivePrincipalFromSession,
} from "./routes/auth/session/logic/principal";
export { refreshSessionToken } from "./routes/auth/session/logic/refresh";
export type {
  AuthRouteDeps,
  RefreshedSession,
  RefreshError,
  RefreshErrorCode,
} from "./routes/auth/session/types";

// Installs/upgrades the `graphile_worker` schema so the webhook's by-name
// `add_job` enqueue works against real Postgres. Composition roots call this
// once at startup.
export { migrateQueue } from "./queue";
