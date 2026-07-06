// Package entry point — the whole public surface. Mirrors the sibling
// packages' documented-export style: named exports only, grouped by concern.
// The runnable entry is `src/main.ts` (composition root, `pnpm start`) — it is
// deliberately NOT exported here; this surface exists for tests and for any
// future embedding of the worker in another process.

// Worker env config (Zod-parsed; injectable env — never reads process.env).
export { loadConfig, ConfigErrorCode } from "./config";
export type { WorkerConfig, ConfigError } from "./config";

// Runner bootstrap: idempotent boot migrations (app + queue schema) + the
// long-lived graphile-worker runner.
export { startWorker } from "./runner";
export type { StartWorkerOptions } from "./runner";

// The `generate` task — the drain side of the ingest→queue→worker pipeline.
export { createGenerateTask } from "./generate";
export type { GenerateTaskDeps, Logger } from "./generate";

// Job-payload boundary (the shared `GenerateJobPayload` handshake).
export { parseGeneratePayload } from "./payload";
export type { ParsedGeneratePayload } from "./payload";

// The GitHub seam: installation-scoped PR reads behind a testable port.
export { appGitHubPort, splitRepoSlug } from "./github-port";
export type { GitHubPort, PullRequestSource } from "./github-port";
