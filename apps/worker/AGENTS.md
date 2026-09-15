# apps/worker — agent notes

The long-lived background worker. Drains graphile-worker's `generate` jobs — the ones `persistence`'s `createIngestRoutines` enqueues — and produces the PR's artifacts: shared Brief, comparison marks, carry-over hunk spans, revision narrative, and pre-warmed delta cores (one per distinct checkpoint SHA, huge-span skip honored). The generation engine is `brief-core`, reused as-is behind its `Generator` port.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Map

**Entry points: `src/index.ts`** (the public surface, `exports["."]` — tests + future embedding) and **`src/main.ts`** (the runnable startup wiring, `pnpm start` — deliberately not exported).

What the layout can't show:

- `task/generate/` is the job. `index.ts` orchestrates payload → tenancy → spend gate → supersession → brief → entry comment → revision artifacts → delta cores → projection + errors; `types.ts`, `consts.ts` and `utils.ts` hold its shapes, tokens and pure helpers. `logic/` holds the steps, most taking the payload and an inputs record: `job-failure` (mark failed, the job.fail and retries-exhausted events), `spend-gate` (the daily cap and the `running` mark, one start), `supersession-watch` (the abort controller and head polls), `errors` (permanent vs transient classification, the provider.error event, the timed generator call), `pr-metadata`, `ticket-context` (the memoized tracker read), `entry-comment-gate` (draft opt-in and the delete-only sweep), `entry-comment-manager` (the four operations over one live comment id; body builders stay in `task/entry-comment.ts`), `brief-generation` (fresh brief: `anchor-decision` for whether to anchor and `anchored-run` for how, then the model call, stitch and write; plus the skip path's retry-resume), `revision-artifacts` (marks + narrative) and `checkpoint-deltas` (one core per checkpoint SHA).
- `task/github-port.ts` is the testable GitHub boundary spanning both credential worlds (App installation client, or a url-box job's grant-resolved viewer token with operator-PAT probe fallback).
- `runner.ts` owns boot order (app-schema → queue-schema migrations) and the long-lived graphile runner.

## Invariants (enforced, don't weaken)

- **Payload handshake:** the job payload shape is the shared `GenerateJobPayload` union in `types` — string ids, snake_case. An App-installation job carries `installation_id`; a url-box job carries `owner_user_id` + `grant_id` (a credential REFERENCE — never token material). Both sides (ingest serializer, `src/task/payload.ts` parser) plus their tests move in lockstep; the compile-time pin in `payload.ts` breaks the build on drift.
- **Tenancy:** everything goes through persistence's ctx-bound interfaces (`createTenantRepository`, `createArtifactStore`, `createGenerationProjection`); the scope identity (installation or url-box owner) enters ONLY via the validated payload — never a spoofable source.
- **Url-box jobs never write to GitHub:** the Entry-comment surface is off entirely for them, and the viewer token is used for reads only — decrypted lazily per job, held in the bound source's closure, never persisted or logged.
- **Abort is not a failure**: supersession → terminal `superseded`, `attempts` untouched, NO graphile retry, no salvage/dump.
- **No double-spend:** brief and delta cores are skip-if-stored; marks and narratives are content-addressed upserts. A retry pays only for what a prior attempt didn't finish.
- **Error classification:** permanent failures (404/406, deterministic generation failures) are marked `failed` and NOT rethrown; transient ones (429/5xx/network) are marked and rethrown so graphile owns retry/backoff.
- **`main.ts` is the composition root and the only reader of `process.env`**; everything else takes `env` or its values as parameters (`loadConfig(env)`, which also parses `WORKER_CONCURRENCY`, the runner's slot count, default 1), brief-core's helpers included. The generator block comes from the instance config (`MERGEBRIEF_CONFIG` → `mergebrief.config.yaml`, else zero-config defaults); BYOK keys resolve by env-var NAME (`generator.apiKeyEnv`) — never from DB or repo config. The tracker root is built there too (`GenerateTaskDeps.trackerRoot`: the env and the `contextSources:` block, tokens by env-var NAME) after `checkConfiguredTrackerReads` refuses boot on a listed tracker it cannot read; the task binds GitHub's transport per job, offers Notion's only to installation jobs, and resolves one read per bound slot when a core needs the ticket.
- **Repo-config is fail-open:** nothing in the `.mergebrief/` phase may fail a generation — fetch failures become loud `fetch-failed` outcomes, invalid files are rejected whole, and an unexpected crash degrades to no-config. Per-file outcomes are recorded on the generation row BEFORE the model call; the policy snapshot rides the brief artifact.
- **Entry-comment draft gate:** the Entry comment stays off draft PRs unless `.mergebrief/settings.yaml` opts in; the delete-only sweep runs ONLY on known-off settings (a settings fetch failure suppresses posting but never deletes a live comment).
- **The daily generation cap gates ONE boundary**: `applySpendGate` starts and marks `running` through `projection.startRun` before any provider call, so a run never counts itself.
  - At cap the run is SKIPPED — terminal `capped` (not `failed`, no retry, no attempt consumed), `evt: spend.cap.trip` at warn. The Entry comment is UPDATED only if one exists, never created; a row already marked `failed` keeps that status.
  - The counter sums ATTEMPTS in the generation store per UTC day across every repo the instance serves; `spend.maxGenerationsPerDay` is one number and `spend.cap.trip` still carries `repo`. `startRun` counts and marks `running` in one transaction under one instance-wide advisory lock, so the cap is exact across slots and worker processes.
- **One scheduled job, and it is not tenant-scoped**: `sweep-audit` runs on graphile's cron (`SWEEP_AUDIT_CRONTAB`, daily) and calls persistence's instance-wide `sweepAuditLog` (retention is an operator env setting — no ctx to bind). Unset retention deletes nothing; a window under the 30-day floor is refused. Worker-only: nothing on a request path may call it.
- **Migrations at boot are idempotent** and ordered app-schema → queue-schema (`startWorker`); the `graphile_worker` schema stays graphile-owned.
- **One process logger**: `main.ts` builds it; the task takes it via `GenerateTaskDeps.log` and stamps `{prId, headSha}` child bindings on every job line; graphile lifecycle logs ride `createGraphileLogFactory`.
  - The first-class `evt` names minted here — `job.fail`, `job.retries.exhausted` (`attempts === max_attempts`), `provider.error`, `spend.cap.trip` — come ONLY from the taxonomy table in `docs/self-host/observability.md`.
  - JOB/PROVIDER failure logs are MESSAGE-ONLY (no `err` field): provider cause chains may carry request contents, and the URL scrub targets URL-shaped secrets, not prompt/diff payloads. Boot failures (`main.ts` catch) are exempt — nothing provider-shaped reaches them, and the `err` field keeps the stack the operator needs.

## Tests

`test/sweep-audit.test.ts` drives the scheduled sweep over the same PGlite harness, seeding aged rows through its raw window.

`test/generate.test.ts` = integration via `persistence/testing`'s PGlite harness (real migrations + the graphile_worker stub), a stub `Generator` (canned outputs parsed through the request's own schema — no model calls), and an in-memory GitHub port (no network). The first test drives the real `createIngestRoutines` enqueue and feeds the task the payload read back from the stubbed jobs table — the contract test for the handshake.

## Verification

Runnable entry: `pnpm -C apps/worker start` (needs `DATABASE_URL`, the GitHub App credentials and the provider key; see `src/config.ts`).
