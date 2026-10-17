// ENTRY POINT: the whole public surface (`package.json` `exports["."]`).
// The runnable entry is `src/main.ts` (startup wiring, `pnpm start`); it is
// deliberately NOT exported here; this surface exists for tests and for any
// future embedding of the worker in another process.

// --- root: boot plumbing ----------------------------------------------------

// Worker env config (Zod-parsed; injectable env, never reads process.env).
export { loadConfig, ConfigErrorCodes } from "./config";
export type { WorkerConfig, ConfigError } from "./config";

// Runner bootstrap: idempotent boot migrations (app + queue schema) + the
// long-lived graphile-worker runner.
export { assertScheduledTasksRegistered, startWorker } from "./runner";
export type { StartWorkerOptions } from "./runner";

// --- task/: the `generate` task + its collaborators -------------------------

// The `generate` task: the drain side of the ingest→queue→worker pipeline.
export {
  createGenerateTask,
  createRecoverGenerationTask,
} from "./task/generate";
export type { GenerateTaskDeps } from "./task/generate";

// The scheduled jobs (graphile cron): audit retention, expired sessions and
// pull request retention.
export {
  createSweepAuditTask,
  SWEEP_AUDIT_CRONTAB,
  SWEEP_AUDIT_TASK,
} from "./task/sweep-audit";
export type { SweepAuditTaskDeps } from "./task/sweep-audit";
export {
  createSweepPullRequestsTask,
  SWEEP_PULL_REQUESTS_CRONTAB,
  SWEEP_PULL_REQUESTS_TASK,
} from "./task/sweep-pull-requests";
export type { SweepPullRequestsTaskDeps } from "./task/sweep-pull-requests";
export {
  createSweepSessionsTask,
  SWEEP_SESSIONS_CRONTAB,
  SWEEP_SESSIONS_TASK,
} from "./task/sweep-sessions";
export type { SweepSessionsTaskDeps } from "./task/sweep-sessions";

// Job-payload boundary (the shared `GenerateJobPayload` handshake).
export { parseGeneratePayload } from "./task/payload";
export type { ParsedGeneratePayload } from "./task/payload";

// The daily generation cap's window helper; enforcement lives inside the task.
export { utcDayBounds } from "./task/spend";
export type { UtcDay } from "./task/spend";

// The GitHub boundary: PR reads over packages/github's bindings behind a testable port.
export {
  createAppGitHubBinders,
  createGitHubPort,
  splitRepoSlug,
} from "./task/github-port";
export type {
  GitHubBinders,
  GitHubPort,
  PullRequestSource,
  RepoParts,
} from "./task/github-port";
