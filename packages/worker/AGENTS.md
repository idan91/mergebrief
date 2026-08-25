# packages/worker — agent notes

The long-lived background worker. Drains graphile-worker's `generate` jobs —
the ones `persistence`'s `createIngestRoutines` enqueues — and produces the PR's
artifacts: shared Brief, comparison marks, carry-over hunk spans, revision
narrative, and pre-warmed delta cores (one per distinct checkpoint SHA,
huge-span skip honored). The generation engine is `brief-core`, reused as-is
behind its `Generator` port.

## Map

**Entry points: `src/index.ts`** (the public surface, `exports["."]` — tests +
future embedding) and **`src/main.ts`** (the runnable startup wiring,
`pnpm start` — deliberately not exported).

```
src/
  index.ts            ENTRY — sectioned re-exports = the public surface
  main.ts             startup wiring — the ONE place env is read + deps wired
  config.ts           Zod env config (DATABASE_URL, MERGEBRIEF_CONFIG,
                      PUBLIC_BASE_URL, AUDIT_RETENTION_DAYS, GitHub App creds)
  runner.ts           boot order (app-schema → queue-schema migrations) +
                      the long-lived graphile-worker runner
  task/               the `generate` task, the scheduled sweep, collaborators
    generate.ts         orchestration: payload → tenancy → idempotent skip →
                        brief/marks/narrative/delta cores → projection + errors
    payload.ts          GenerateJobPayload boundary (string ids → branded)
    entry-comment.ts    Entry-comment pure builders (delete+repost lives
                        in generate.ts)
    github-port.ts      the GitHub boundary: PR reads + repo-file read behind a
                        testable port; two credential worlds — App installation
                        client, or a url-box job's grant-resolved viewer token
                        (lazy decrypt, operator-PAT probe fallback)
    sweep-audit.ts      the audit-retention sweep — the ONE scheduled job
                        (graphile cron), instance-wide rather than ctx-bound
    repo-config.ts      the `.mergebrief/` phase: fetch 3 default-
                        branch paths → validateRepoConfig → RepoContext +
                        origin/artifact serialization. NEVER fails the job
test/                 generate.test.ts + sweep-audit.test.ts = integration
                      via persistence/testing
```

## Invariants (enforced, don't weaken)

- **Payload handshake:** the job payload shape is the shared
  `GenerateJobPayload` union in `types` — string ids, snake_case; an
  App-installation job carries `installation_id`, a url-box job carries
  `owner_user_id` + `grant_id` (a credential REFERENCE — never token
  material). Both sides (ingest serializer, `src/task/payload.ts` parser)
  plus their tests move in lockstep; the compile-time pin in `payload.ts`
  breaks the build on drift.
- **Tenancy:** everything goes through persistence's ctx-bound interfaces
  (`createTenantRepository`, `createArtifactStore`, `createGenerationProjection`); the scope identity
  (installation or url-box owner) enters ONLY via the validated payload —
  never a spoofable source.
- **Url-box jobs never write to GitHub:** the Entry-comment surface is off
  entirely for them, and the viewer token is used for reads only — decrypted
  lazily per job, held in the bound source's closure, never persisted or
  logged.
- **Abort is not a failure**: supersession → terminal
  `superseded`, `attempts` untouched, NO graphile retry, no salvage/dump.
- **No double-spend:** brief and delta cores are skip-if-stored; marks and
  narratives are content-addressed upserts. A retry pays only for what a
  prior attempt didn't finish.
- **Error classification:** permanent failures (404/406, deterministic
  generation failures) are marked `failed` and NOT rethrown; transient ones
  (429/5xx/network) are marked and rethrown so graphile owns retry/backoff.
- **Env is injected** (`loadConfig(env)`); only `main.ts` reads
  `process.env`. The generator block comes from the instance config
  (`MERGEBRIEF_CONFIG` → `mergebrief.config.yaml`, else zero-config
  defaults); BYOK keys resolve by env-var NAME (`generator.apiKeyEnv`) —
  never from DB or repo config.
- **Repo-config is fail-open:** nothing in the
  `.mergebrief/` phase may fail a generation — fetch failures become loud
  `fetch-failed` outcomes, invalid files are rejected whole, and an
  unexpected crash degrades to no-config. Per-file outcomes are recorded on
  the generation row BEFORE the model call; the policy snapshot rides the
  brief artifact.
- **Entry-comment draft gate:** the Entry comment
  stays off draft PRs unless `.mergebrief/settings.yaml` opts in; the
  delete-only sweep runs ONLY on known-off settings (a settings fetch
  failure suppresses posting but never deletes a live comment).
- **The daily generation cap gates ONE boundary**: the cap check sits
  in `runGeneration` before `markRunning` and before any GitHub/provider
  call, so the run it is deciding on can never count itself. At the cap the
  run is SKIPPED — terminal `capped` (not `failed`, no retry, no attempt
  consumed), `evt: spend.cap.trip` at warn, and an Entry comment is UPDATED
  only if one already exists (never created) — except that a row already
  marked `failed` keeps that status (an at-cap graphile retry must not erase
  the real failure). The counter is the generation store, scoped by
  `repo_id` and the current UTC day, summing ATTEMPTS rather than rows.
  Its accuracy assumes the SINGLE-SLOT runner (`DEFAULT_CONCURRENCY = 1` in
  `runner.ts`): the gate reads and decides without a lock, so running at
  concurrency C admits up to `cap + C - 1` runs before the cap bites.
- **One scheduled job, and it is not tenant-scoped**: `sweep-audit` runs on
  graphile's cron (`SWEEP_AUDIT_CRONTAB`, daily) and calls persistence's
  instance-wide `sweepAuditLog` — audit retention is an operator env setting,
  so there is no ctx to bind it to. Unset retention runs the job and deletes
  nothing; a window under the 30-day floor is refused, not widened. The sweep
  stays worker-only: nothing on a request path may call it.
- **Migrations at boot are idempotent** and ordered app-schema → queue-schema
  (`startWorker`); the `graphile_worker` schema stays graphile-owned.
- **Logging goes through the `packages/logging` boundary**:
  `main.ts` builds the one process logger; the task takes it via
  `GenerateTaskDeps.log` and stamps `{prId, headSha}` child bindings on every
  job line; graphile lifecycle logs ride `createGraphileLogFactory`. The
  first-class `evt` names minted here — `job.fail`, `job.retries.exhausted`
  (`attempts === max_attempts`), `provider.error`, `spend.cap.trip` — come
  ONLY from the logging package's taxonomy table. JOB/PROVIDER failure logs
  are MESSAGE-ONLY (no `err` field): provider cause chains may carry request
  contents — and the logging boundary's URL scrub targets URL-shaped secrets, not
  prompt/diff payloads, so it is no substitute. Boot failures (`main.ts`
  catch) are exempt: nothing provider-shaped reaches them, and the `err`
  field keeps the stack the operator needs.

## Conventions

Mirrors the sibling packages (see root `CLAUDE.md` + `persistence/AGENTS.md`):
no `enum`, strict TS, no bare `as`, Zod at boundaries, named exports,
extensionless relative imports, verb-first function names.

## Tests

`test/sweep-audit.test.ts` drives the scheduled sweep over the same PGlite
harness, seeding aged rows through its raw window.

`test/generate.test.ts` = integration via `persistence/testing`'s PGlite
harness (real migrations + the graphile_worker stub), a stub `Generator`
(canned outputs parsed through the request's own schema — no model calls),
and an in-memory GitHub port (no network). The first test drives the real
`createIngestRoutines` enqueue and feeds the task the payload read back from the
stubbed jobs table — the contract test for the handshake.

## Verification

```sh
pnpm -C packages/worker typecheck
pnpm -C packages/worker test
pnpm lint                        # repo-root oxlint --type-aware
```

Runnable entry: `pnpm -C packages/worker start` (needs DATABASE_URL, GitHub
App creds, and the provider key — see `src/config.ts` / `src/main.ts`).
