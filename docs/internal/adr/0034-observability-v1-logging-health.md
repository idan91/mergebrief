# 0034: Observability v1: structured logging, health surface, adopter hooks

Status: superseded in part by 0046
Date: 2026-07-21

Decided on a wayfinder map
(five grill tickets, all closed 2026-07-21); grounded in a primary-source
cohort survey (Plausible,
Cal.com, n8n, Outline, Gitea/Forgejo, PostHog, Supabase + pino/Hono/
graphile-worker specifics).

## Context

All three processes (web server with the mounted `/api` Hono app, worker,
and the CLI-facing API inside the web tier) log via bare `console.*` — no
levels, no shared structure, no correlation ids. The one exception is the
D9 access-log contract (`logAccess` in the api package's `routes/authz.ts`, since replaced by `apps/api/src/request-logging.ts`),
which already emits structured JSON. Compose health is a web check probing
`/` (full SSR render) and worker process-liveness. An adopter cannot hook
alerting into anything except raw stdout text. The survey establishes the
cohort baseline: structured JSON to stdout, level env var, unauthenticated
liveness/readiness pair, and nothing more as table stakes — Prometheus and
OTel are off-by-default or absent in every default self-host deploy.

## Considered Options

- Logger: pino behind a thin boundary / LogLayer / zero-dependency hand-rolled
  logger / winston.
- Hono glue: hono-pino / @hono/structured-logger / hand-rolled middleware.
- Health: endpoints inside the Hono `/api` app vs the server entry; single
  DB-checking endpoint vs liveness+readiness split; migration-state checks.
- Correlation: payload-carried request ids vs stable domain keys.
- Metrics/tracing in v1: Prometheus, OTel, in-app log transports.

## Decision

1. **Logger = pino (major 10) behind our own boundary** in a new
   `packages/logging` package. The boundary exports a minimal `Logger`
   interface — `error/warn/info/debug(msg, fields?)` + `child(bindings)` —
   and `createLogger(opts)`, the only place pino is constructed. pino types
   never leak to call sites; a later OTel/metrics addition reimplements the
   interface without touching call sites. Four levels only (matches
   graphile-worker); fatal moments log `error` and exit. `pino-pretty` is a
   devDependency. Rejected: LogLayer (a facade over loggers — our boundary IS
   the facade), zero-dep hand-roll (viable but forfeits battle-tested
   serialization + redaction for one small dep), winston (heavier, no
   stronger fit).
2. **Hono request-logging middleware is hand-rolled (~30 lines) in
   `apps/api`**, emitting a per-request child logger and the
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
   `connectionString`, `databaseUrl`} at top level, one wildcard depth, and
   under `params` at both (`REDACT_PATHS` in
   `packages/logging/src/logger.ts`).
   Error serialization: pino's stock `err` serializer (amended, see
   Amendments: a content scrub wraps it).
5. **Event taxonomy** — dot-namespaced `evt` names; the canonical table
   (amended, see Amendments: `docs/self-host/observability.md` owns the live
   table):

   | `evt` | level | key fields | alert-worthy |
   |---|---|---|---|
   | `webhook.verify.fail` | warn | `deliveryId`, `reqId` | yes (sustained rate — raw hits are scanner noise) |
   | `webhook.dispatch.fail` | error | `deliveryId`, `reqId` | yes |
   | `job.fail` | error | `prId`, `headSha`, `permanent`, `attempt`, `maxAttempts` | yes |
   | `job.retries.exhausted` | error | `prId`, `headSha`, `attempt` | yes (THE worker alert; minted by the task when the queue gives up on the job or the head spends its claims, `apps/worker/src/task/generate/logic/job-failure.ts` and `run-decision.ts` — graphile has no distinct event) |
   | `provider.error` | error | `provider`, `status`, ambient job bindings | yes (401/403 = config broken, alert now; sustained 429/5xx = degraded) |
   | `token.refresh.fail` | error | `reqId`, `reviewerId` | yes |
   | `audit.fail` | error | `reqId`, artifact ids | yes (posted to GitHub, our audit write failed — data integrity) |
   | `spend.cap.trip` | warn | `repo`, `prId`, `headSha`, `cap`, `dayUtc` | yes (sustained rate — a capped instance is silently producing no briefs) |
   | `api.access` | info | D9 fields (`method`, `path`, `status`, `durationMs`, `decision`, …) + `reqId` + `operation` | no |

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
   fields (amended, see Amendments); `{prId, headSha}` appears on both sides of the queue and is the
   durable join. graphile's `jobId`/`workerId`/`taskIdentifier` ride free
   via the injected logger adapter. Field names camelCase. Correlated logs
   ARE the v1 trace; no tracing system (see #8).
7. **Health surface:** `/healthz` + `/readyz`, answered in the TanStack
   server entry BEFORE the Hono branch and the page router — bare
   top-level paths deliberately outside `/api`, unauthenticated (cohort
   norm), zero interaction with session middleware or the Bearer
   carve-out. `/healthz`: static 200, zero dependencies — alive even while
   Hono-app composition is failing. `/readyz`: `getWebhookApp()` resolves
   + `SELECT 1` through its db handle; 200/503 with constant tiny JSON
   (leaks nothing). NOT checked: migration state (api and worker both
   migrate at boot by default, `MERGEBRIEF_AUTO_MIGRATE=false` makes a boot
   check-only, `apps/api/src/boot/migrate.ts`;
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
   observability is strictly adopter-local). (amended, see Amendments: OTel
   tracing is in, off by default, per ADR 0046.)

## Why This Way

The survey showed the entire cohort converging on exactly this bar and no
higher: stdout JSON + level env + unauthenticated health pair. Every
stronger option (metrics endpoints, tracing, in-app shipping) is
off-by-default, reverted (Forgejo's 2-day OTel revert), or absent in
default deploys. Building to the observed standard keeps v1 small, and the
boundary + stable-`evt` contract make every deferred addition (OTel, metrics,
LOG_FORMAT, structured-logger adoption) a contained, non-breaking upgrade.

## Consequences

- New package `packages/logging`; all three processes construct one logger
  at their startup wiring and inject it (worker AGENTS.md discipline).
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

## Amendments

### 2026-08-03: The spend cap trips at warn

`spend.cap.trip` goes live at `warn`, not the reserved `error`: a tripped cap
is the guardrail working as configured, not an operator-actionable fault; it
earns `error` nowhere in the level standard. It is alertable on sustained
rate (the operator wants to know their instance stopped briefing). Emitted by
the worker's generation gate on every capped skip; `prId` rides the job's
child bindings.

### 2026-08-17: The access line names the operation

Recorded with ADR 0040. `api.access` gains the Product Operation `operation`
id. The log and the `audit_log` table stay separate and both, transport vs
intent, joined on `reqId`: the log answers "what crossed the wire", the table
answers "what was done", it records actions and denials only, and it carries
no HTTP status.

### 2026-09-08: Health moves with the API process

The health endpoints kept their semantics; what changed is which process
answers them, on the ticket that gave the API its own process.

- `/healthz` and `/readyz` now exist on both `apps/api` and `apps/web`, ahead
  of each entry's own routing. The API's `/readyz` still resolves its handle
  and runs `SELECT 1`; the web tier's calls the API origin's `/readyz`
  directly, not through `/api/*`, with a 2s budget, because a web tier that
  cannot reach the API is not ready even when its own process is fine.
- `getWebhookApp()` is gone with the web server's webhook app. The API's
  composition root is `apps/api/src/main.ts`, and it validates config,
  resolves the session key and migrates before it listens, so the
  "unmigrated window" #7 accepted no longer exists for the API.
- The compose healthcheck still probes `/healthz` only, on both services, for
  the reason recorded in #7: an upstream blip must not restart the web tier.
- Health still sits ahead of the routing, for a new reason. #7 justified the
  position by saying health must answer while the Hono app fails to compose;
  in the API's own process composition completes before `serve()` runs. The
  position is kept because `createApp` mounts request-id, the `api.access`
  line and the audit middleware at `*`, so health answered as an ordinary
  route would be logged and audited on every probe. At a 15s healthcheck that
  is thousands of access lines a day for a static 200. Converting these to
  routes is not the cleanup it looks like.

### 2026-10-18: Tracing joins, superseded in part by ADR 0046

#6: `GenerateJobPayload` carries an optional `traceparent`; `{prId, headSha}`
stays the durable join. #8: OTel tracing is in, off by default; Prometheus,
in-app log transports and telemetry back to us stay out. The web tier now
mints `X-Request-Id` for every request and overwrites a client's value
(`apps/web/src/server/request-id.ts`), so the api's accepted inbound id is
always web's.

### 2026-10-20: A content scrub sits beside key-path redaction

#4's key-path redaction is one of two mechanisms. The log boundary also scrubs
content: every `msg` and every string field of a serialized `err` or `error`
passes `scrubSecrets` (`packages/logging/src/logger.ts`, patterns in
`packages/logging/src/scrub.ts`), replacing URL-shaped substrings with
`[redacted-url]` (`file://` exempt, for ESM stack frames) and issuer-prefixed
tokens (`sk-`, `ghp_`, `github_pat_`, `xox`, `mergebrief_`, `AKIA` and kin)
with `[redacted-token]`. Prefix matching, never entropy; no disable knob. The
two cover different threats: redaction protects secrets we hold and name,
the scrub protects secrets embedded in prose we do not control, such as a
provider's error text quoting the key it rejected. `sanitizeErrorDetail`
consumes the same vocabulary, so a credential closed on one exit cannot leak
through the other. Narrowing either scrub needs an amendment here.

### 2026-10-20: The event table lives in the self-host docs

#5's table is no longer the canonical list. `docs/self-host/observability.md`
owns the `evt` taxonomy: first-class names come only from its table (root
`AGENTS.md`), additions land there under #5's non-breaking rule, and it now
names lifecycle lines this record left unnamed (`generation.enqueue`,
`generation.start`, `generation.complete`, `generation.succeeded`) plus the
events later work added (`url-box-token.owner.fail`, `artifact.check.fail`,
`update.available`, `update.check.fail`, `db.version.upgrade`,
`db.version.ahead`). The table above is the decision-time snapshot; read the
docs for the live contract.
