# 0015: Self-Hosted Runtime: One Long-Lived Worker + Postgres as the Single Stateful Dependency

Status: amended (see Amendments)

The product backend runs as a **long-lived worker process** (not serverless functions) beside the web and API processes, with **one Postgres** as the *only* stateful dependency — relational store, job queue (`graphile-worker`), and single-flight lock in one. No external broker (SQS / Redis / RabbitMQ / Kafka), no swappable datastore. This closes epic-plan gating decisions #1 (datastore) and #2 (runtime) together, under the OSS-self-host-first distribution model (`docs/internal/system-overview.md` §1).

## Context

Distribution is **OSS self-host first**: the binding constraint is "self-host = `docker compose up`", so every extra service is an adoption tax. ADR 0006 deferred the worker's lock/queue backend; ADR 0008 chose "single relational DB" and deferred the compute stack. This ADR closes both.

Job shape: long-running (minutes, up to ~10 min Opus stream — ADR 0006 #10), low-frequency and bursty (validation volume: a few orgs, ~hundreds of jobs/day), needing debounce (~60 s), single-flight per `(repo, pr)`, and cancellation on a superseded head. Writes are idempotent + content-keyed (ADR 0006 #6), so at-least-once delivery is sufficient. Vercel Hobby caps functions at 60 s and crons at once/day — serverless cannot host the long generation.

## Considered Options

- **Worker host.** Serverless functions (rejected — 60 s cap can't hold a minutes-long generation; chunking one LLM stream doesn't fit a durable-workflow step model) · **long-lived worker container (chosen)**; the web tier was to stay serverless-compatible (fast DB writes only); ADR 0042 made the api its own long-lived process.
- **Queue / lock backend.** SQS (rejected — AWS-only breaks self-host portability; dual-write) · RabbitMQ / Kafka (rejected — heavy stateful services, massive overkill; Kafka is a log, not a queue) · Redis / BullMQ (rejected — extra service, durability footgun, dual-write) · **Postgres via `graphile-worker` (chosen)** — zero extra service, transactional enqueue, *job keys* for debounce/single-flight, `LISTEN/NOTIFY` wakeups. A broker stays behind a port for a future scale migration.
- **Datastore choice for adopters.** Swappable DB / NoSQL (rejected — N adapters/migrations/dialects to maintain for zero user benefit; worse fit for the relational anchoring + ref-counted retention of ADR 0008) · SQLite (rejected *as default* — single-writer + shared-filesystem breaks the split web/worker topology; viable only as a future single-container profile) · **one opinionated vanilla Postgres (chosen)**.
- **M1 retention.** Reference-counted GC now (ADR 0008) (deferred — machinery unneeded at validation volume; GC is additive and reversible) · **simplest-correct (chosen)** — retain working artifacts for the PR's life, freeze the Receipt at submit, persist the baseline snapshot (force-push survival, ADR 0006 #8; amended, see Amendments), sweep on PR-close + grace.

## Decision

1. **Long-lived worker container**, beside the web and api processes (ADR 0042). The webhook handler only writes/coalesces a job row — it never generates inline.
2. **One Postgres** = relational store + `graphile-worker` queue + single-flight lock. **No external broker. No swappable DB.** Vanilla Postgres 16+, no proprietary extensions (portable across container / RDS / Neon / Cloud SQL).
3. **Debounce** via job keys on `(repo, pr)`, leading-edge: the first push fixes `run_at`, later pushes only swap the head (`packages/persistence/src/stores/ingest.ts`); **single-flight** via a claim on the `generation` row under a two-minute database-clock lease the holder renews (`packages/persistence/src/stores/generation.ts`, `apps/worker/src/task/generate/logic/claim-recovery.ts`), the advisory lock serving only the instance spend cap; **cancellation** by head-SHA comparison at safe checkpoints — never aborting a generation a human is awaiting (ADR 0006 #6; amended, see Amendments).
4. **Migrations via Drizzle** (typed schema-as-code; large artifacts stay `TEXT` per ADR 0008, not ORM-mapped).
5. **M1 retention** = retain working artifacts during the PR's life + freeze the Receipt at submit + persist the baseline snapshot (amended, see Amendments) + sweep on close + grace. The sweep is opt-in: `PR_RETENTION_DAYS` unset keeps every pull request (`apps/worker/src/task/sweep-pull-requests.ts`). Ref-counted GC deferred.
6. The retention sweep is **config-driven** and a **deletion boundary** (purge by PR / by repo) is left in place, so compliance-grade retention + data-eviction / right-to-erasure (Q7 / GPT-5.5 #6) is additive, not a retrofit.

## Why This Way

The self-host constraint makes "fewest services" the dominant criterion. Postgres is already required, so the queue and lock ride on it for free, and brokers solve a throughput/decoupling problem we sit ~5 orders of magnitude away from. One opinionated store is itself an adoption feature (Sentry / GitLab / Plausible). Deferring GC honors useful-tool-first, while the config-driven sweep + deletion boundary keep the compliance door open without building the eviction engine before storage hurts.

## Consequences

- **Self-host = `docker compose up`** (postgres, api, web, worker; `docker-compose.yml`, ADR 0042). No broker or cache to operate.
- The queue lives **behind a port** → swapping to a real broker is a one-adapter change if volume ever demands it.
- The worker needs **its own small DB pool** (a 10-min job must not starve the web pool) and uses claim-commit-run-update, never a transaction held open for the whole job.
- **Compliance / retention / eviction, secret redaction, encryption-at-rest, audit deletion** are deferred to the trust/tenancy ADR (Q7); the boundary in Decision #6 is the only piece that had to land now.
- Builds on ADR 0006 (worker/lock), ADR 0008 (single relational DB + retention logical model), and the OSS-self-host distribution model (`docs/internal/system-overview.md` §1).

## Amendments

### 2026-10-20: Cancellation aborts mid-call

ADR 0006 #6's "never abort a generation a human is awaiting" exception was retired on 2026-07-05 (view-tracking went with `activated_at`), and this record never followed. Cancellation is cooperative and mid-call: supersession is checked before each artifact call and by a ~20s head poll during streaming, and a mismatch aborts the provider call through an `AbortController` (`apps/worker/src/task/generate/logic/supersession-watch.ts`); the generation projection records `superseded`.

### 2026-10-20: The baseline snapshot was never built

The persisted baseline snapshot in the M1 retention option and #5 never existed: no code wrote or read `diff_snapshot`, and migration 0058 dropped the table and its config gate (ADR 0018 D4 as amended). A checkpoint span GitHub can no longer serve gets no delta and the view falls back to the full Brief. Retention keeps working artifacts, the Receipt and the opt-in closed-PR sweep.
