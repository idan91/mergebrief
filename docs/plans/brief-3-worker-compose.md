# Plan — BRIEF-3: Background worker + one-command docker-compose (P4 / M1 · WS3)

> Status: **planned 2026-07-06** — awaiting go. Ticket: Notion BRIEF-3
> ("P4 · Background worker + one-command docker-compose"). Last of P4/M1;
> completes "make self-hosting real".
> Decisions locked: ADR 0006 (worker + cancellation, as amended 2026-07-05),
> ADR 0013 (BYOK), ADR 0015 (long-lived worker, Postgres-only), ADR 0016
> (trust boundary), ADR 0018 (schema). No grilling needed — execution only.

## What this delivers (product + technical context)

**Product:** today the tool only produces a brief when someone manually runs a
generation. BRIEF-3 makes it **live**: a self-hoster runs one command
(`docker-compose up`), installs the GitHub App on a repo, and from then on
every PR gets its brief generated automatically in the background — push code,
brief appears, reviewer opens it. No manual step. This is the last piece of
"make self-hosting real": after this the project is a complete, installable
product rather than a toolkit.

**Technical:** everything before this built the *inbox* — webhooks already
write a debounced `generate` job into the Postgres queue; nobody reads it yet.
PR 1 builds the reader: a long-running worker that picks up jobs, fetches the
PR diff, runs the existing generator (unchanged, just wrapped), saves the
artifact, and records success/failure — aborting cleanly (and stopping token
spend) when a new push makes the in-flight brief obsolete; an abort is not an
error. PR 2 is the packaging: Docker images for web + worker beside Postgres
in one compose file, plus self-host docs and a real end-to-end smoke. The
careful design work is the job-handling and cancellation logic (state
transitions, no double-spending); the rest is plumbing.

## Scope boundary (from the 2026-07-05 scope check)

**Already shipped in BRIEF-2 — do not rebuild:**

- Trailing-debounce transactional enqueue — `packages/persistence/src/ingest.ts`
  (`graphile_worker.add_job` by name, `run_at = now() + debounce`, job replaced
  per trigger; task identifier fixed at `GENERATE_TASK_IDENTIFIER = "generate"`).
- Queue schema bootstrap — `packages/api/src/queue.ts` (`migrateQueue`).
- Terminal-PR enqueue gating; `superseded` projection semantics
  (`packages/persistence/src/generation.ts` — mid-call abort never consumes a retry).
- Single-flight / retries / dead-letter are **graphile-owned** (`job_key`);
  no new lock machinery.

**BRIEF-3 = the drain side only:** graphile-worker runner + `generate` task,
wrapping the existing stateless `Generator` (`tools/categorizer` — reused as-is,
never rewritten), driving generation-projection transitions, cooperative
superseded-abort — plus the packaging that makes `docker-compose up` real.

**Resolved open question:** ADR 0006 §6 (amended 2026-07-05) retired the
"never abort a generation a human is awaiting" exception — view-tracking was
dropped with `activated_at`, so it's unknowable. Cancellation is cooperative
and mid-call: supersession check before each artifact call **and** a cheap
head-poll (~20s) during streaming; abort via the SDK `AbortSignal`; abort is
not a failure (no retry, no salvage, `attempts` untouched, terminal
`superseded` status).

## Mandatory skills (confirmed 2026-07-06)

- **`git-eng`** — ALL git operations go through it explicitly (branching,
  commits, push, PR). Requirements below.
- **`typescript-eng`** — TS monorepo standards throughout.
- **`verify`** — drive the changed flow end-to-end before committing
  nontrivial chunks; the compose smoke (Part 6) is the capstone verify.

## git-eng requirements

- Start point: fresh `main` — `git checkout main && git pull` (local main is
  behind; PRs #25–#28 merged remotely). Never commit to `main`.
- One branch per PR, matching the BRIEF-2 pattern:
  - PR 1: `feature/BRIEF-3/worker-runtime`
  - PR 2: `feature/BRIEF-3/compose-packaging` (branched off PR 1 once merged)
- **Chunked commits** — commit after each logical unit (≈ one part).
- **Pre-commit review gate:** before EVERY commit, dispatch
  `security-reviewer` + `performance-reviewer` in parallel on staged changes;
  findings with confidence ≥ 80 → present, fix, re-stage, re-run until clean.
- No `Co-Authored-By` trailers; no AI-attribution in PR descriptions.
- Push via the gh HTTPS helper (SSH is down; see memory `git-push-workflow`).
- PR titles: `[BRIEF-3] feat: Worker Runtime` / `[BRIEF-3] feat: Compose Packaging`.

## Part / PR breakdown

### PR 1 — `feature/BRIEF-3/worker-runtime` (est. ~700–900 changed LOC incl. tests)

Under the ~1000 LOC ceiling only if tests stay disciplined; if the task
implementation (Part 2) balloons past ~500 LOC on its own, split Part 4 out
into a standalone micro-PR rather than stretching this one.

**Part 1 — `packages/worker` scaffold + runner bootstrap.**
New package (name-check `packages/*` conventions): graphile-worker `run()`
with the `generate` task registered, env-driven config (reuse
`persistence/src/config.ts` patterns; DATABASE_URL, BYOK key resolved by
env-name per ADR 0013/0016 — never DB/repo), calls `migrateQueue` +
persistence migrations idempotently at boot, graceful shutdown (SIGTERM →
finish/abort in-flight, release pool). Add to CI matrix (BRIEF-1 lesson:
don't ship a package CI doesn't cover).
*Run:* main thread, sequential. *Model:* Sonnet / medium effort — scaffolding
against documented graphile-worker API.

**Part 2 — `generate` task implementation.**
The deep module: payload validation (shape written by `ingest.ts` — treat as
the contract, add a shared type in `@code-review/types` if absent) → tenant
context → fetch PR data via `packages/github` installation client → call
`AnthropicGenerator` / `generateAndWrite` (`tools/categorizer/src/lib.ts`) →
idempotent `ArtifactStore` span writes → generation-projection transitions
(`running` → `succeeded` / `failed` / `superseded`) + audit emit. Full/delta
selection per ADR 0006 §4 (delta cores pre-warmed per distinct checkpoint SHA;
huge-span skip honored). PGlite tests against a stubbed Generator.
*Run:* main thread, sequential (depends on Part 1). *Model:* **Fable / high
effort** — this is the subtle part (state transitions, idempotency, error
mapping).

**Part 3 — Cooperative cancellation.**
Supersession check before each artifact call + ~20s head-poll during
streaming; `AbortController` threaded into the Generator call; on mismatch
abort → terminal `superseded`, no retry, `attempts` untouched. Verify the
projection's existing `superseded` transition covers mid-call abort (it was
designed for exactly this).
*Run:* main thread, sequential (extends Part 2). *Model:* Fable / high effort
— concurrency + billing-stop semantics.

**Part 4 — octokit retry tuning (406).**
`retry.doNotRetry: [406]`-style option at client construction in
`packages/github/src/app-auth.ts` (App) and `oauth.ts` (user clients) —
octokit v4 bundles the retry plugin; nothing sets `doNotRetry` today. 406 =
oversized diff, permanent per span; retrying is waste. Covers both the
worker's `fetchDiff` and the read API's diff proxy.
*Run:* main thread. *Model:* Sonnet / low-medium — small, mechanical, but add
a regression test asserting no retry on 406.

### PR 2 — `feature/BRIEF-3/compose-packaging` (est. ~300–500 changed LOC)

**Part 5 — Dockerfiles + compose extension.**
Dockerfiles for web + worker (monorepo-aware build; check the workspace tool
before writing them), **extend the existing Postgres-only
`docker-compose.yml`** (keep loopback-only port binding) with `web` + `worker`
services: healthchecks, `depends_on` Postgres-healthy, env passthrough for
BYOK/App credentials by env-name, migrations idempotent at boot (both queue
schema and app schema). One command: `docker-compose up`.
*Run:* main thread. *Model:* Sonnet / medium — infra plumbing; escalate only
if the web app's server runtime complicates containerization.

**Part 6 — Self-host docs + compose smoke.**
README self-host section + `docs/self-host/` / `docs/dev/webhook-loop.md`
updates (env var table, App setup pointer, smee/dev loop against compose).
Capstone **verify**: `docker-compose up` from clean state → webhook (or
seeded job) → worker generates against a real key → artifact readable via the
reviewer API. Update `oss-roadmap.md` progress log + Notion BRIEF-3 on completion.
*Run:* main thread. *Model:* Sonnet / medium; verify driven interactively.

### Sequencing

Strictly sequential, single main-thread session per PR (parts share context;
no parallel subagents — each would cold-start the monorepo context for no
gain). PR 1 fully merged before PR 2 branches.

## Implementation steps (condensed)

1. `git-eng`: sync main, branch `feature/BRIEF-3/worker-runtime`.
2. Part 1 → review gate → commit. 3. Part 2 (TDD-ish: PGlite + stub Generator
   first) → verify locally → review gate → commit. 4. Part 3 → review gate →
   commit. 5. Part 4 → review gate → commit. 6. PR 1 via git-eng; merge.
7. Branch `feature/BRIEF-3/compose-packaging`. 8. Part 5 → review gate →
   commit. 9. Part 6 (verify capstone) → review gate → commit → PR 2.
10. Tick BRIEF-3 done: Notion card + `oss-roadmap.md` P4 status → done.

## Session bootstrap (cold-start anchors — verified 2026-07-06)

- **Tooling:** pnpm 10 monorepo. Root scripts are per-package shims
  (`test` = categorizer, `test:persistence`, `lint` = oxlint type-aware +
  web). Packages test with `vitest run`. Follow the existing per-package
  pattern when adding `packages/worker` scripts.
- **CI:** `.github/workflows/ci.yml` — change-detecting jobs per package
  (`lint`, `webapp-checks`, `categorizer-checks`, `persistence-checks`,
  `github-checks`, `api-checks`). Part 1 must add a `worker-checks` job in
  the same shape (path filter incl. `packages/types/`, lockfile, workspace files).
- **Job payload contract** (`ingest.ts` ~L229): job_key `generate:<prRow.id>`,
  payload `{ installation_id, pull_request_id, head_sha }` — ids cross as
  **strings** (JSON can't carry bigint); the worker re-brands them through
  `TenantContextSchema`. This is the documented handshake — the comment in
  `ingest.ts` names the BRIEF-3 worker explicitly.
- **Config pattern:** `packages/github/src/config.ts` (`loadConfig`) is the
  existing env-resolution precedent (App creds by env-name); mirror it for the
  worker's env (DB URL, provider key name) rather than inventing a new one.
- **Ticket:** Notion card `3935e940-0eeb-8107-80b9-d357cc28040d`
  ("P4 · Background worker + one-command docker-compose", Ticket BRIEF-3) —
  set Status → Done at the end.
- **Docs convention:** roadmap/progress-log updates are docs-only housekeeping
  → committed straight to `main` (Idan pushes); code goes via PR.

## Definition of done

- [ ] `docker-compose up` from a clean checkout brings up Postgres + web +
      worker; migrations (app + queue schema) run idempotently at boot.
- [ ] Webhook (or seeded job) → worker generates via BYOK key → artifact
      readable through the reviewer API (the Part 6 verify capstone).
- [ ] Superseding push mid-generation → in-flight job aborts, projection ends
      `superseded`, no retry consumed, next job generates the new head.
- [ ] 406 from GitHub is not retried (regression test).
- [ ] `packages/worker` covered by CI; all matrix jobs green.
- [ ] Self-host docs updated; `oss-roadmap.md` P4 → done + progress-log entry;
      Notion BRIEF-3 → Done.

## Risks / watch items

- **Payload contract drift** — worker must consume exactly what `ingest.ts`
  enqueues; pin with a shared type + a test on both sides.
- **Web app containerization** — `apps/web` is the unknown (server runtime /
  adapter); if it fights Docker, timebox and consider shipping worker+Postgres
  compose first with web run via `npm` as documented fallback (flag to Idan
  before descoping).
- **Abort semantics** — ensure an aborted Anthropic stream doesn't surface as
  a graphile job failure (would burn `attempts`); catch abort distinctly.
