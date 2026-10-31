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
  createSyncEntryTask,
} from "./task/generate";
export type { GenerateTaskDeps } from "./task/generate";

// The scheduled jobs (graphile cron): audit retention, expired sessions,
// pull request retention and webhook delivery expiry.
export {
  createSweepAuditTask,
  SWEEP_AUDIT_CRONTAB,
  SWEEP_AUDIT_TASK,
} from "./task/sweep-audit";
export type { SweepAuditTaskDeps } from "./task/sweep-audit";
export {
  createSweepGenerationPartsTask,
  SWEEP_GENERATION_PARTS_CRONTAB,
  SWEEP_GENERATION_PARTS_TASK,
} from "./task/sweep-generation-parts";
export type { SweepGenerationPartsTaskDeps } from "./task/sweep-generation-parts";
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
export {
  createSweepWebhookDeliveriesTask,
  SWEEP_WEBHOOK_DELIVERIES_CRONTAB,
  SWEEP_WEBHOOK_DELIVERIES_TASK,
} from "./task/sweep-webhook-deliveries";
export type { SweepWebhookDeliveriesTaskDeps } from "./task/sweep-webhook-deliveries";

// Job-payload boundary (the shared `GenerateJobPayload` handshake).
export { parseGeneratePayload } from "./task/payload";
export type { ParsedGeneratePayload } from "./task/payload";

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
