# packages/worker — agent notes

The long-lived background worker (BRIEF-3, P4/M1 workstream 3; ADRs 0006 as
amended, 0013, 0015, 0016, 0018). Drains graphile-worker's `generate` jobs —
the ones `persistence`'s `ingestRoutines` enqueues — and produces the PR's
artifacts: shared Brief, comparison marks, revision narrative, and pre-warmed
delta cores (one per distinct checkpoint SHA, huge-span skip honored). The
generation engine is `categorizer`, reused as-is behind its `Generator` port.

## Invariants (enforced, don't weaken)

- **Payload handshake:** the job payload shape is the shared
  `GenerateJobPayload` type in `types` — string ids, snake_case. Both sides
  (ingest serializer, `src/payload.ts` parser) plus their tests move in
  lockstep; the compile-time pin in `payload.ts` breaks the build on drift.
- **Tenancy:** everything goes through persistence's ctx-bound seams
  (`forTenant`, `artifactStore`, `generationProjection`); the installation id
  enters ONLY via the validated payload (ADR 0016 — never a spoofable source).
- **Abort is not a failure** (ADR 0006 #6): supersession → terminal
  `superseded`, `attempts` untouched, NO graphile retry, no salvage/dump.
- **No double-spend:** brief and delta cores are skip-if-stored; marks and
  narratives are content-addressed upserts. A retry pays only for what a
  prior attempt didn't finish.
- **Error classification:** permanent failures (404/406, deterministic
  generation failures) are marked `failed` and NOT rethrown; transient ones
  (429/5xx/network) are marked and rethrown so graphile owns retry/backoff.
- **Env is injected** (`loadConfig(env)`); only `main.ts` reads
  `process.env`. BYOK key resolves by env-var NAME (`GENERATOR_API_KEY_ENV`,
  default `ANTHROPIC_API_KEY`) — never from DB or repo config (ADR 0013).
- **Migrations at boot are idempotent** and ordered app-schema → queue-schema
  (`startWorker`); the `graphile_worker` schema stays graphile-owned.

## Conventions

Mirrors the sibling packages (see root `CLAUDE.md` + `persistence/AGENTS.md`):
no `enum`, strict TS, no bare `as`, Zod at boundaries, named exports,
extensionless relative imports, verb-first actions / noun factories.

## Tests

`test/generate.test.ts` = integration via `persistence/testing`'s PGlite
harness (real migrations + the graphile_worker stub), a stub `Generator`
(canned outputs parsed through the request's own schema — no model calls),
and an in-memory GitHub port (no network). The first test drives the real
`ingestRoutines` enqueue and feeds the task the payload read back from the
stubbed jobs table — the contract test for the handshake.

## Verification

```sh
pnpm -C packages/worker typecheck
pnpm -C packages/worker test
pnpm lint                        # repo-root oxlint --type-aware
```

Runnable entry: `pnpm -C packages/worker start` (needs DATABASE_URL, GitHub
App creds, and the provider key — see `src/config.ts` / `src/main.ts`).
