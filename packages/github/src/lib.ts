// Package entry point — the whole public surface (BRIEF-2 stage 1). Mirrors
// `packages/persistence/src/lib.ts`'s documented-export style: named exports
// only, grouped by concern.

// Local `Result`/`ValueOf` — this package does not import them from
// `persistence` at runtime (type-only imports of branded ids are the sole
// exception; see `app-auth.ts`).
export type { Result, ValueOf } from "./types";

// GitHub client env config (Zod-parsed; injectable env — never reads
// `process.env`).
export { loadConfig, ConfigErrorCode } from "./config";
export type { GitHubConfig, ConfigError } from "./config";

// GitHub App authentication: App-JWT client + installation-scoped Octokit
// minting. JWT signing and installation-token minting/caching are owned by
// octokit's `App` class, not hand-rolled here.
export { createAppClient, getInstallationClient } from "./app-auth";
export type { AppClient } from "./app-auth";
