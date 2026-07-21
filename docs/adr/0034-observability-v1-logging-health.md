# 0034 — Observability v1: structured logging, health surface, adopter hooks

Status: accepted (2026-07-21). Decided on the BRIEF-51 wayfinder map
(five grill tickets, all closed 2026-07-21); grounded in the primary-source
cohort survey `docs/plans/brief-51-observability-survey.md` (Plausible,
Cal.com, n8n, Outline, Gitea/Forgejo, PostHog, Supabase + pino/Hono/
graphile-worker specifics). Implementation plan:
`docs/plans/brief-51-observability-v1.md`.

## Context

All three processes (web server with the mounted `/api` Hono app, worker,
and the CLI-facing API inside the web tier) log via bare `console.*` — no
levels, no shared structure, no correlation ids. The one exception is the
D9 access-log contract (`logAccess` in `packages/api/src/routes/authz.ts`),
which already emits structured JSON. Compose health is a web check probing
`/` (full SSR render) and worker process-liveness. An adopter cannot hook
alerting into anything except raw stdout text. The survey establishes the
cohort baseline: structured JSON to stdout, level env var, unauthenticated
liveness/readiness pair, and nothing more as table stakes — Prometheus and
OTel are off-by-default or absent in every default self-host deploy.

## Considered Options

- Logger: pino behind a thin seam / LogLayer / zero-dependency hand-rolled
  logger / winston.
- Hono glue: hono-pino / @hono/structured-logger / hand-rolled middleware.
- Health: endpoints inside the Hono `/api` app vs the server entry; single
  DB-checking endpoint vs liveness+readiness split; migration-state checks.
- Correlation: payload-carried request ids vs stable domain keys.
- Metrics/tracing in v1: Prometheus, OTel, in-app log transports.

## Decision

1. **Logger = pino (major 10) behind our own seam** in a new
   `packages/logging` package. The seam exports a minimal `Logger`
   interface — `error/warn/info/debug(msg, fields?)` + `child(bindings)` —
   and `createLogger(opts)`, the only place pino is constructed. pino types
   never leak to call sites; a later OTel/metrics addition reimplements the
   interface without touching call sites. Four levels only (matches
   graphile-worker); fatal moments log `error` and exit. `pino-pretty` is a
   devDependency. Rejected: LogLayer (a facade over loggers — our seam IS
   the facade), zero-dep hand-roll (viable but forfeits battle-tested
   serialization + redaction for one small dep), winston (heavier, no
   stronger fit).
2. **Hono request-logging middleware is hand-rolled (~30 lines) in
   `packages/api`**, emitting a per-request child logger and the
   D9-shaped request line. Rejected: hono-pino (security-only maintenance
   mode), `@hono/structured-logger` (official Hono org and pino-docs
   endorsed, but v0.1.0 single release — revisit at a healthy 1.x; the swap
   is contained behind our middleware). The middleware stays out of
   `packages/logging` so that package remains framework-free.
3. **Env + format:** bare `LOG_LEVEL` (default `info`). Format is
   NODE_ENV-decided — JSON unless `NODE_ENV=development` (dev-only
   pino-pretty transport); no `LOG_FORMAT` env in v1 (addable later,
   non-breaking; pretty-in-prod escape hatch = pipe stdout through the
   `pino-pretty` CLI). Output is stdout only, never files; rotation and
   shipping are operator-side (12-factor; compose ships `json-file`
   `max-size`/`max-file` defaults).
4. **Redaction:** secrets ride only as structured fields, never
   interpolated into `msg` (extends the root standards rule); pino `redact`
   with `remove: true` — redacted keys VANISH, no `[Redacted]`
   placeholder (accepted trade-off: no tripwire signal of a bad log call;
   the code standard is the primary guarantee). Paths:
   `headers.authorization`, `headers.cookie`,
   `headers["x-hub-signature-256"]`, and {`token`, `accessToken`,
   `refreshToken`, `secret`, `webhookSecret`, `privateKey`, `clientSecret`,
   `connectionString`, `databaseUrl`} at top level + one wildcard depth.
   Error serialization: pino's stock `err` serializer.
5. **Event taxonomy** — dot-namespaced `evt` names; the canonical table:

   | `evt` | level | key fields | alert-worthy |
   |---|---|---|---|
   | `webhook.verify.fail` | warn | `deliveryId`, `reqId` | yes (sustained rate — raw hits are scanner noise) |
   | `webhook.dispatch.fail` | error | `deliveryId`, `reqId` | yes |
   | `job.fail` | error | `prId`, `headSha`, `permanent`, `attempt`, `maxAttempts` | yes |
   | `job.retries.exhausted` | error | `prId`, `headSha`, `attempt` | yes (THE worker alert; minted by the task at `attempt === maxAttempts` — graphile has no distinct event) |
   | `provider.error` | error | `provider`, `status`, ambient job bindings | yes (401/403 = config broken, alert now; sustained 429/5xx = degraded) |
   | `token.refresh.fail` | error | `reqId` or job bindings | yes |
   | `audit.fail` | error | `reqId`, artifact ids | yes (posted to GitHub, our audit write failed — data integrity) |
   | `spend.cap.trip` | error | (reserved) | yes — NAME RESERVED for BRIEF-20, not implemented here |
   | `api.access` | info | D9 fields (`method`, `path`, `status`, `durationMs`, `decision`, …) + `reqId` | no |

   `api.access` renames the D9 `evt: "read"` (pre-OSS-cutover, zero
   adopters — the rename is free now; breaking-change entry + D9 doc
   update ship with the implementation). Everything else — graphile
   lifecycle logs (via the adapter), boot/shutdown, brief-salvage warns,
   web client errors — stays plain leveled logging without `evt` names: a
   small contract we can keep stable. Post-cutover, `evt`
   renames/removals/field changes require a breaking-change entry
   (`docs/api-changelog.md` process); additions are non-breaking.
   Level judgment standard (root AGENTS.md): every line earns its level —
   `error` = operator-actionable now; `warn` = degraded/suspicious,
   alertable on sustained rate; `info` = terse operational signal;
   otherwise `debug` or delete.
6. **Correlation:** `hono/request-id` (Hono built-in) on the `/api` app —
   inbound `X-Request-Id` accepted (operator-controlled infrastructure in a
   self-host deployment; length-guarded), UUID minted otherwise, echoed in
   the response. Webhook events also log `deliveryId`
   (`x-github-delivery`, previously unread). The generation pipeline's
   correlation key is `{prId, headSha}` as child-logger bindings on every
   job log — deliveries COALESCE into one pending job
   (`job_key = generate:{pr_id}`, `job_key_mode: replace`), so no single
   delivery owns a job and `GenerateJobPayload` grows NO correlation
   fields; `{prId, headSha}` appears on both sides of the queue and is the
   durable join. graphile's `jobId`/`workerId`/`taskIdentifier` ride free
   via the injected logger adapter. Field names camelCase. Correlated logs
   ARE the v1 trace; no tracing system (see #8).
7. **Health surface:** `/healthz` + `/readyz`, answered in the TanStack
   server entry BEFORE the Hono branch and the page router — bare
   top-level paths deliberately outside `/api`, unauthenticated (cohort
   norm), zero interaction with session middleware or the BRIEF-18 Bearer
   carve-out. `/healthz`: static 200, zero dependencies — alive even while
   Hono-app composition is failing. `/readyz`: `getWebhookApp()` resolves
   + `SELECT 1` through its db handle; 200/503 with constant tiny JSON
   (leaks nothing). NOT checked: migration state (worker migrates at boot;
   the unmigrated window is seconds and self-heals — revisit trigger: a
   real deploy burned by the window ⇒ add a drizzle journal-vs-table
   check), GitHub reachability (external; must not pull us from the LB),
   worker (no HTTP surface — process-liveness + restart, cohort norm;
   n8n's opt-in listener is the precedent if k8s readiness ever matters).
   Compose healthcheck moves `/` → `/healthz` and never `/readyz` (a DB
   blip must not trigger restart churn — Gitea's warning). `/api/version`
   is untouched: it stays the CLI's authenticated liveness probe (ADR 0029
   #8) and is NOT orchestrator health (ADR 0016 #5 amended).
8. **Explicitly not in v1:** Prometheus, OTel (Backlog board ticket "OTel
   tracing support (adopter-local, off-by-default)" holds the revival,
   demand-triggered; correlation ids map onto trace ids there), in-app log
   transports (stdout is the integration point; Datadog/Loki/CloudWatch
   are docs recipes), and any telemetry back to us (vision.md non-goal —
   observability is strictly adopter-local).

## Why This Way

The survey showed the entire cohort converging on exactly this bar and no
higher: stdout JSON + level env + unauthenticated health pair. Every
stronger option (metrics endpoints, tracing, in-app shipping) is
off-by-default, reverted (Forgejo's 2-day OTel revert), or absent in
default deploys. Building to the observed standard keeps v1 small, and the
seam + stable-`evt` contract make every deferred addition (OTel, metrics,
LOG_FORMAT, structured-logger adoption) a contained, non-breaking upgrade.

## Consequences

- New package `packages/logging`; all three processes construct one logger
  at their composition root and inject it (worker AGENTS.md discipline).
- The D9 rename (`read` → `api.access`) and the compose healthcheck move
  are breaking for anyone scripted against them — recorded as
  breaking-change entries at implementation (pre-cutover, cost ≈ 0).
- Operators get a documented, greppable contract: `docs/self-host/`
  gains `observability.md` (event table, health semantics, correlation
  guide, Grafana/Loki worked recipe + short Datadog/CloudWatch pointers,
  rotation defaults).
- `webhook.verify.fail` finally makes signature failures visible — today
  the 401 path is silent.
- Root AGENTS.md becomes the canonical repo-standards file (CLAUDE.md a
  symlink to it) and carries the log-level judgment standard.
