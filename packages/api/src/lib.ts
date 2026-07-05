// Package entry point — the whole public surface (BRIEF-2 stage 4). The app
// factory is the only export: consumers (the `apps/web` catch-all mount,
// stage 5) build deps and hand them in; routes are internal wiring.
export { createApp } from "./app";
export type { AppDeps, AuthDeps } from "./app";

// The serialized token-refresh orchestrator (BRIEF-2 stage 6, D11): built +
// tested here, called by stage 7's authz middleware on a GitHub 401.
export { refreshSessionToken, RefreshErrorCode } from "./routes/auth";
export type { RefreshError, RefreshedSession, AuthRouteDeps } from "./routes/auth";

// Queue schema bootstrap — install/upgrade the `graphile_worker` schema so the
// webhook's by-name `add_job` enqueue works against real Postgres. Composition
// roots call this once at startup; BRIEF-2 installs only (worker = BRIEF-3).
export { migrateQueue } from "./queue";
