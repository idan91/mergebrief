// ENTRY POINT — the whole public surface (`package.json` `exports["."]`).
// Mirrors the sibling packages' documented-export style: named exports only,
// grouped by the folder/module it lives in. Map: `AGENTS.md`.
// The runnable entry is `src/main.ts` (composition root, `pnpm start`) — it is
// deliberately NOT exported here; this surface exists for tests and for any
// future embedding of the worker in another process.

// --- root — boot plumbing ----------------------------------------------------

// Worker env config (Zod-parsed; injectable env — never reads process.env).
export { loadConfig, ConfigErrorCode } from "./config";
export type { WorkerConfig, ConfigError } from "./config";

// Runner bootstrap: idempotent boot migrations (app + queue schema) + the
// long-lived graphile-worker runner.
export { startWorker } from "./runner";
export type { StartWorkerOptions } from "./runner";

// --- task/ — the `generate` task + its collaborators -------------------------

// The `generate` task — the drain side of the ingest→queue→worker pipeline.
export { createGenerateTask } from "./task/generate";
export type { GenerateTaskDeps, Logger } from "./task/generate";

// Job-payload boundary (the shared `GenerateJobPayload` handshake).
export { parseGeneratePayload } from "./task/payload";
export type { ParsedGeneratePayload } from "./task/payload";

// The daily generation cap's window helper (BRIEF-20); enforcement lives
// inside the task.
export { utcDayBounds } from "./task/spend";
export type { UtcDay } from "./task/spend";

// The GitHub seam: installation-scoped PR reads behind a testable port.
export { appGitHubPort, splitRepoSlug } from "./task/github-port";
export type {
  CompareFiles,
  GitHubPort,
  PullRequestSource,
} from "./task/github-port";

// Anchored-generation machinery (BRIEF-143): pure plan + stitch helpers,
// exported for the eval harness's revision-pair runner (tools/categorizer) —
// the pairs must exercise the SAME partition/stitch the production task runs.
export { planAnchoredGeneration, stitchBrief } from "./task/anchoring";
export type {
  AnchorPlan,
  AnchorPlanArgs,
  FrozenCarry,
  ReLookEntry,
  StitchArgs,
  StitchError,
  StitchResult,
} from "./task/anchoring";
