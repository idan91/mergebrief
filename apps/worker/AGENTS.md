# apps/worker: agent notes

The long-lived background worker. Drains graphile-worker's `generate` jobs, the ones `persistence`'s `createIngestRoutines` enqueues, and produces the PR's artifacts: shared Brief, comparison marks, carry-over hunk spans, revision narrative, and pre-warmed delta cores (one per distinct checkpoint SHA; a span too large for one delta call stores a skip record instead). The generation engine is `brief-core`, reused as-is behind its `Generator` port.

## Map

Entry points: `src/index.ts` (the public surface; tests and future embedding) and `src/main.ts` (the runnable startup wiring, `pnpm start`, deliberately not exported).

## Topic docs

Topic docs under `apps/worker/docs/` bind as firmly as this file. In this file and its topic docs, `docs/dev/`, `docs/self-host/`, `docs/media/`, root files such as `DESIGN.md`, and paths starting `apps/` or `packages/` are the repo root's. Every other path is under `apps/worker/`, often written without its `src/` prefix or leading folders (a bare `logic/` is `task/generate/logic/`); `git ls-files apps/worker | grep <path>` finds it.

Before editing a source file, run `git grep -n <file name without extension> -- apps/worker/docs` (for an `index.ts`, its folder's name) and read every doc whose hits name your file. Also read any doc whose trigger below names your work:

- **Generation run**: touching `runner.ts`, `task-list.ts`, `task/job-span.ts`, `task/url-box-regeneration.ts`, `logic/run-artifacts.ts`, `logic/run-signals.ts`, or anything under `task/generate/` that no trigger below names (orchestration, pools, multi-call runs, pinning, span marks, narratives and delta cores, lockfile summaries): read `docs/generation-run.md`.
- **GitHub and trackers**: touching `task/github-port.ts`, `task/issue-api.ts`, `logic/ticket-context.ts`, `tracker-boot.ts`, `jira-access.ts`, the operator PAT, or a tracker's transport or boot check: read `docs/github-and-trackers.md`.
- **Entry comment**: touching `task/entry-comment/`, `logic/entry-comment-gate.ts`, `logic/entry-comment-manager.ts`, `logic/entry-sync.ts`, a `logic/*-entry.ts` body, an Entry post, its compare-and-set, its delete or `sync-entry`: read `docs/entry-comment.md`.
- **Pre-claim gates**: touching `logic/author-gate.ts`, `logic/condition-check/`, `logic/run-gates.ts`, `logic/pr-metadata.ts`, `trustedBots` or a held row: read `docs/pre-claim-gates.md`.
- **Spend cap and claims**: touching `logic/spend-gate.ts`, `logic/run-decision.ts`, `logic/claim-recovery.ts`, `logic/run-artifacts.ts`, `logic/run-signals.ts`, a claim or its lease, a stored brief's settle, a refund or a large run's units: read `docs/spend-cap.md`.
- **Scheduled jobs**: touching `task/sweep-*.ts`, `task/revoke-at-github.ts`, `task/reconcile-webhook-deliveries/`, a cron task or the failure-dump sweep: read `docs/scheduled-jobs.md`.
- **Output secret guard**: touching `logic/output-secret.ts` or a secret the worker holds: read `docs/output-secret.md`.
- **Testing**: writing or changing a test: read `docs/testing.md`.

## Composition root

- **`main.ts` is the composition root and the only reader of `process.env`** besides `instrument.ts`, the telemetry preload (`--import` ahead of `main.ts` in `pnpm start` and the image), which reads the `OTEL_*` config only and starts `logging/tracing`; `main.ts` stops it after the pool closes.
- Both load `apps/worker/.env`, then the workspace root's `.env` (`src/env-file.ts`), keeping a value already set, and `main.ts` then names the workspace root's `mergebrief.config.yaml` in `MERGEBRIEF_CONFIG` when the variable is unset and the file exists (`applyDefaultConfigPath`).
- Everything else takes `env` or its values as parameters, brief-core's helpers included. `loadConfig(env)` parses `WORKER_CONCURRENCY` and `WORKER_LARGE_CONCURRENCY`, the two runners' slot counts, default 1 each, resolves `generator.detailConcurrency` to `DEFAULT_DETAIL_CONCURRENCY` (8) when the block omits it, and reads `generator.revisionNarrative` and `generator.hugeSpanRatio`, each at its brief-core default when the block omits it.
- The generator block comes from the instance config (`MERGEBRIEF_CONFIG` → `mergebrief.config.yaml`, else zero-config defaults); BYOK keys resolve by env-var NAME (`generator.apiKeyEnv`), never from DB or repo config.
- `main.ts` also builds the tracker root; the task binds GitHub's transport per job (`docs/github-and-trackers.md`).

## Edge contracts

- **Payload handshake:** the job payload shape is the shared `GenerateJobPayload` union in `types`: string ids, snake_case. An App-installation job carries `installation_id`; a url-box job carries `owner_user_id` + `grant_id` (a credential REFERENCE, never token material). Task ids come from `types`' `QueueTasks`. The shape changes additively (`docs/dev/architecture.md`): the parser (`src/task/payload.ts`) takes a new field as optional, and the compile-time pin there breaks the build when the parser requires a field the contract does not guarantee. It cannot see jobs already queued, so review holds the additive rule. The optional `traceparent` is read apart from the job's fields (`readPayloadTraceparent`), so a bad one costs the span link, never the job; every task `buildTaskList` registers runs through `traceJob`, one root OTel span per job linked to the enqueue.
- **Tenancy:** everything goes through persistence's ctx-bound interfaces (`createTenantRepository`, `createArtifactStore`, `createGenerationProjection`); the scope identity (installation or url-box owner) enters ONLY via the validated payload, never a spoofable source.
- **Url-box jobs never write to GitHub:** the Entry-comment surface is off entirely for them, and the viewer token is used for reads only, decrypted lazily per job, held in the bound source's closure, never persisted or logged.
- **Error classification, the worker's throw exception:** permanent failures (404/406, deterministic generation failures, persistence's `ScopeViolationError` and `InvalidArtifactBodyError`) are marked `failed` and NOT rethrown; transient ones (429/5xx/network) are marked and rethrown so graphile owns retry/backoff. `logic/job-failure.ts` reads the thrown class once and decides the retry.
- **Failure and row-write fences:** no run marks a `succeeded` row `failed` or `superseded`, and no failure moves an `awaiting-trigger` row, not even one thrown before the run read it. Every row write after the claim is fenced by the run id; a lost claim stands down without a write or a retry. Ahead of any write that ends a run `failed`, the run queues the head's Entry sync. Detail: `docs/spend-cap.md`, `docs/pre-claim-gates.md`, `docs/entry-comment.md`.
- **Abort is not a failure:** supersession → terminal `superseded`, `attempts` untouched, NO graphile retry, no salvage/dump. A shutdown releases the claim and hands the job back to graphile, except on the job's last attempt: no retry follows, so the run ends `failed` as `attempts-exhausted` like any last attempt. A pinned multi-call run is the exception to supersession (`docs/generation-run.md`).

## Invariants (enforced, don't weaken)

- **No double-spend:** brief cores are skip-if-stored; a narrative or delta core is skipped when stored under marks written from the bases resolved now (span marks, `docs/generation-run.md`); marks and narratives are content-addressed upserts. A retry pays only for what a prior attempt didn't finish, with one exception: a run that stops between a core's write and its key's marks write pays that core again, and the longest such window is a stale delta sharing the revision key, whose rewrite sits between the narrative and the marks.
- **Write checks are warn-only:** each Brief, Delta Brief and Revision narrative runs its `brief-core/artifact` write check before the write (`logic/artifact-check`); a failure logs `artifact.check.fail` with `kind` (a `GenerationKinds` value, as on `generation.complete`), `issueCount`, `firstPath` and the generated body is written unchanged. A Brief's check accepts this run's custom risk names plus the tokens on its carried chunks. Stored Briefs are read back only through `readStoredBrief`; an issue's `message` is never a log field.
- **No secret leaves through the output:** `main.ts` wraps the generator in `guardGeneratorOutput` (`logic/output-secret.ts`) over every secret value the worker holds, so a Brief or Delta Brief carrying one fails as `output-secret`, permanent, and a Revision narrative carrying one is dropped with the Brief unaffected; the log names the field and env var, never the value.
- **Repo-config is fail-open:** nothing in the `.mergebrief/` phase may fail a generation, except the pre-claim `settings.yaml` read of the author gate (a bot PR), which retries a transient failure while attempts remain (`docs/pre-claim-gates.md`). Both pre-claim gates first read a transient failure again in the run (`acquireGateRepoConfig`: after 250 ms, 750 ms and 1.5 s), spending no attempt and writing no row between tries; the trigger-condition check then applies the instance's conditions alone. Fetch failures become loud `fetch-failed` outcomes, invalid files are rejected whole, and an unexpected crash degrades to no-config. Per-file outcomes are recorded on the generation row BEFORE the model call; the policy snapshot rides the brief artifact.
- **Migrations at boot are idempotent** and ordered app-schema → queue-schema (`startWorker`), both inside persistence's migration lock through `ensureAppSchema`'s `migrateQueue`; the `graphile_worker` schema stays graphile-owned.
- **One process logger:** `main.ts` builds it; the task takes it via `GenerateTaskDeps.log` and stamps `{prId, headSha}` child bindings on every job line; graphile lifecycle logs ride `createGraphileLogFactory`. The `evt` names this worker mints are the taxonomy rows in `docs/self-host/observability.md` whose source is worker.
- **JOB/PROVIDER failure logs are MESSAGE-ONLY** (no `err` field): provider cause chains may carry request contents, and the URL scrub targets URL-shaped secrets, not prompt/diff payloads. Boot failures (`main.ts` catch) are exempt: nothing provider-shaped reaches them, and the `err` field keeps the stack the operator needs.

## Verification

- `test/graphile-claim.test.ts` is the handshake's contract test: real graphile on `MERGEBRIEF_TEST_POSTGRES_URL` claims the job persistence enqueued through the worker's own `buildTaskList` (`src/task-list.ts`, which `main.ts` registers), and the payload passes `parseGeneratePayload`. It skips locally without the URL and fails under `CI`.
- Runnable entry: `pnpm -C apps/worker start` (needs `DATABASE_URL`, the GitHub App credentials and the provider key; see `src/config.ts`).
