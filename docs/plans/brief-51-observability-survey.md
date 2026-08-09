# BRIEF-51 — Observability survey: how comparable OSS self-hosted backends do it

Primary-source survey (official docs + source on the default branch, fetched
2026-07-20) of Plausible, Cal.com, n8n, Outline, Gitea/Forgejo, PostHog, and
Supabase, plus the Node-stack specifics for our own surface (pino, Hono,
graphile-worker) and a verification pass over the ticket's claims about this
repo. Research doc only — no code changes.

## TL;DR

The observed baseline is narrower than the ticket's option space: every
surveyed project logs to stdout with a level env var, most emit JSON in
production (pretty/colorized in dev), the ops-mature ones expose a
liveness/readiness HTTP pair, and **nothing more is table stakes** — Prometheus
is instrumented-but-off-by-default at best (absent in Outline and Cal.com,
scraped by nobody's default deploy), and OTel traces are absent or
explicitly disabled in every default self-host deployment. Alerting is
universally left to the operator; the richest first-party story is "enable
the metrics flag and scrape it with your own Prometheus + Grafana" (n8n,
Gitea Enterprise, supabase-grafana example).

**The standard is:**

- Structured JSON logs to stdout in production, pretty formatting in dev,
  via a mainstream logger — winston/pino/structlog/tslog/Elixir Logger.
- Log level from an env var: bare `LOG_LEVEL` for single-service products,
  `<PRODUCT>_LOG_LEVEL` for namespaced ones (`N8N_LOG_LEVEL`,
  `GOTRUE_LOG_LEVEL`, `PGRST_LOG_LEVEL`); default `info`.
- HTTP health endpoints: a no-dependency liveness path and (in the more
  operated products) a separate readiness path that pings the DB —
  `/healthz` + `/healthz/readiness` (n8n), `/_livez` + `/_readyz` (PostHog),
  `/api/system/health/live|ready` (Plausible).
- Prometheus `/metrics` shipped behind an off-by-default flag or not at all;
  never scraped by the project's own compose stack.
- OTel: optional at most, off by default everywhere; not a v1 requirement
  anywhere in this cohort.

This matches 12-factor logs: "each running process writes its event stream,
unbuffered, to `stdout`"; "A twelve-factor app never concerns itself with
routing or storage of its output stream" (https://12factor.net/logs).

## Comparison table

| Project | Log format (prod default) | Level env | Health endpoints | Prometheus | OTel |
|---|---|---|---|---|---|
| Plausible | Elixir Logger, plaintext default; `LOG_FORMAT=json` opt-in (ex_json_logger) | `LOG_LEVEL` (default `notice` in CE) | `/api/system/health/live`, `/api/system/health/ready` (+ legacy `/api/health`); undocumented for operators | PromEx shipped, `PROMEX_DISABLED` defaults `true` | Deps shipped, exporter Honeycomb-gated; off otherwise |
| Cal.com | tslog JSON in prod, pretty in dev (web); winston JSON in prod (API v2) | `NEXT_PUBLIC_LOGGER_LEVEL` (web, numeric); `LOG_LEVEL` (API v2) | None in web app; `/health` static "OK" in API v2; zero compose healthchecks | Absent | Absent (Sentry only, env-gated) |
| n8n | winston, plaintext default; `N8N_LOG_FORMAT=json` opt-in | `N8N_LOG_LEVEL` (default `info`) | `/healthz` (liveness), `/healthz/readiness` (DB connected+migrated); documented for operators | Shipped, off by default (`N8N_METRICS=true`) | Shipped (≥2.19.0), `N8N_OTEL_ENABLED` default false |
| Outline | winston JSON in prod, colorized dev (env-decided, no toggle) | `LOG_LEVEL` (default `info`) | `/_health` (Postgres `SELECT 1` + Redis ping); used by own Dockerfile HEALTHCHECK, undocumented in hosting docs | Absent (optional Datadog `dd-trace`) | Absent |
| Gitea / Forgejo | Own log module, plaintext only — no JSON option exists | `[log] LEVEL` in app.ini / `GITEA__log__LEVEL` (Forgejo: `FORGEJO__log__LEVEL`); default `Info` | `/api/healthz` (DB + cache ping, JSON body, 424 on fail); k8s liveness-probe documented; source warns against Docker HEALTHCHECK use | Shipped in core, `[metrics] ENABLED` default false, optional bearer `TOKEN` | Absent in both (Forgejo merged OTel 2024-08-05, reverted 2 days later) |
| PostHog (hobby) | structlog console-renderer default (`LOGGING_FORMATTER_NAME=json` opt-in); plugin-server pino JSON in prod | `DJANGO_LOG_LEVEL`; `LOG_LEVEL` (plugin-server); `RUST_LOG` (Rust services) | `/_livez`, `/_readyz` (+ deprecated `/_health`); Node services `/_health`, `/_ready`; built for k8s, unused by hobby compose | Instrumented (`/_metrics`, port 8001 exporter) but nothing scrapes it in hobby | Shipped, **explicitly disabled** in hobby compose (`OTEL_SDK_DISABLED: 'true'`) |
| Supabase (docker) | Per-service JSON to stdout (GoTrue logrus JSON, Storage pino, Realtime Elixir Logger) | `GOTRUE_LOG_LEVEL`, `LOG_LEVEL` (storage, realtime), `PGRST_LOG_LEVEL` | Every service has a compose healthcheck: GoTrue `/health`, PostgREST `--ready` (+ admin `/live`,`/ready`), Storage `/status`, Realtime tenant `/health` | Realtime/Supavisor live (JWT-authed `/metrics`); GoTrue/Storage opt-in flags off in compose; no scraper ships | Shipped per-service (GoTrue, Storage), unconfigured in compose |

## Per-project notes

### Plausible (plausible/analytics @ master; CE compose @ plausible/community-edition)

- Elixir `Logger` to stdout; `LOG_FORMAT=standard` (default, plaintext) vs
  `LOG_FORMAT=json` via `{ExJsonLogger, :format}`, metadata
  `[:request_id, :trace_id]` (`plausible/analytics: config/runtime.exs` L23–46;
  dep `{:ex_json_logger, "~> 1.4.0"}` in `mix.exs`).
- `LOG_LEVEL` default `notice` for CE builds, `warning` otherwise; no
  dev/prod format split — format is solely `LOG_FORMAT`
  (`config/runtime.exs` L26–33).
- Health trio: `/api/system/health/live` (static ok), `/api/system/health/ready`
  (Postgres + ClickHouse `SELECT 1`, cache readiness; 500 on fail), legacy
  `/api/health` marked for removal (`lib/plausible_web/router.ex` L395–406,
  `lib/plausible_web/controllers/api/system_controller.ex`).
- The CE `compose.yml` healthchecks only Postgres and ClickHouse; the app
  container has **no healthcheck**, and the CE wiki (Home + Configuration
  checked in full) documents none of `LOG_LEVEL`/`LOG_FORMAT`/health
  endpoints/`PROMEX_DISABLED`
  (`plausible/community-edition: compose.yml`;
  https://raw.githubusercontent.com/wiki/plausible/community-edition/Configuration.md).
- PromEx wired into the endpoint (`lib/plausible_web/endpoint.ex` L72, default
  path `/metrics` per https://prom-ex.hexdocs.pm/PromEx.Plug.html) but
  `PROMEX_DISABLED` defaults `true` (`config/runtime.exs` L1008–1015).
- Full OTel dep suite in `mix.exs`, but exporter only turns on when
  `HONEYCOMB_API_KEY` + `HONEYCOMB_DATASET` are set; otherwise
  `sampler: :always_off, traces_exporter: :none` (`config/runtime.exs`
  L253–266, 963–979).

### Cal.com (calcom/cal.com @ main f004349; calcom/docker @ main)

- Web/shared: tslog 4.9.2, `type: IS_PRODUCTION ? "json" : "pretty"`, with
  `maskValuesOfKeys` for password/credential keys
  (`packages/lib/logger.ts`, `packages/lib/package.json` L31).
- Platform API v2 (NestJS): winston via nest-winston — prod `format.json()`,
  dev colorized simple; optional Axiom transport if `AXIOM_TOKEN` set
  (`apps/api/v2/src/lib/logger.ts`).
- Levels: `NEXT_PUBLIC_LOGGER_LEVEL` numeric 0–6, default 4=warn
  (`.env.example` L409–411); API v2 `LOG_LEVEL` default `info`.
- Health: **no health route at all in the web app** (exhaustive route-tree
  scan; nearest is `apps/web/app/api/version/route.ts`); API v2 has
  `GET /health` returning static `"OK"` (`apps/api/v2/src/app.controller.ts`).
  Official `calcom/docker: docker-compose.yaml` has **zero healthcheck
  sections**.
- Prometheus and OTel: absent — no `prom-client` or `@opentelemetry/*` in any
  of the monorepo's 119 package.json manifests (blob-less clone scan @
  f004349). Tracing = Sentry only, `SENTRY_TRACES_SAMPLE_RATE` default `0.0`
  (`apps/web/instrumentation.ts`).
- Self-host docs contain no monitoring/alerting/log-shipping guidance beyond
  `NEXT_PUBLIC_DEBUG=1` for trpc logging (`calcom/docs:
  pages/introduction/quick-start/self-hosting/installation.mdoc` L74).

### n8n (n8n-io/n8n @ master; docs.n8n.io)

- winston behind a custom Logger service; default plaintext to console,
  `N8N_LOG_FORMAT=json` = "one JSON object per line containing the message,
  level, timestamp and all the metadata"
  (`packages/@n8n/backend-common/src/logging/logger.ts`;
  `packages/@n8n/config/src/configs/logging.config.ts`;
  https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables/logs).
- `N8N_LOG_LEVEL` (`error|warn|info|debug|silent`, default `info`),
  `N8N_LOG_OUTPUT` (`console`/`file`), file rotation vars, `N8N_LOG_SCOPES`
  (same config file + docs page). Dev-vs-prod formatting branches only at
  `debug` level (colorized dev columns vs plain prod columns, logger.ts).
- `/healthz` liveness ("should not care about DB connections" — source
  comment) vs `/healthz/readiness` (200 only when DB connected + migrated +
  fully ready, else 503) (`packages/cli/src/abstract-server.ts`,
  `setupHealthCheck()`); path configurable via `N8N_ENDPOINT_HEALTH`.
  Both are operator-documented; queue-mode workers need
  `QUEUE_HEALTH_CHECK_ACTIVE=true` for their own health server
  (https://docs.n8n.io/deploy/host-n8n/keep-n8n-running/monitor-n8n).
- Prometheus shipped but off: `N8N_METRICS=true` enables `/metrics`
  (prom-client 15 + express-prom-bundle in `packages/cli/package.json`), with
  a ~dozen `N8N_METRICS_*` group toggles
  (`packages/@n8n/config/src/configs/endpoints.config.ts`).
- OTel shipped natively since 2.19.0, `N8N_OTEL_ENABLED` default false, OTLP
  to `N8N_OTEL_EXPORTER_OTLP_ENDPOINT`; docs call it "still under
  development"
  (https://docs.n8n.io/deploy/host-n8n/keep-n8n-running/trace-executions-with-opentelemetry).
- Alerting story: docs say use the health endpoints, enable metrics, scrape
  with Prometheus, visualize in Grafana (scrape config + dashboards
  provided); no alert rules; log *streaming* is Enterprise-tier
  (https://docs.n8n.io/deploy/host-n8n/keep-n8n-running/visualize-metrics-with-grafana;
  https://docs.n8n.io/deploy/host-n8n/keep-n8n-running/set-up-logging).

### Outline (outline/outline @ main)

- winston wrapped in a custom Logger; **prod = `winston.format.json()`, dev =
  colorized plaintext**, decided by environment with no env toggle; a
  `sanitize()` step strips tokens/passwords from logged objects in prod
  (`server/logging/Logger.ts`).
- `LOG_LEVEL` — "one of error, warn, info, http, verbose, debug, or silly",
  default `info` (`.env.sample`; enforced in Logger.ts).
- `GET /_health` = combined liveness+dependency check (Postgres `SELECT 1` +
  Redis ping, 500 on fail; no separate readiness path)
  (`server/main.ts` ~L77–92). The official Dockerfile uses it as its
  HEALTHCHECK, but the hosting docs never document it
  (`outline/outline: Dockerfile`;
  https://docs.getoutline.com/s/hosting/doc/docker-7pfeLP5a8t).
- No Prometheus dep; APM is optional Datadog `dd-trace`, active only when
  `DD_API_KEY` is set (`server/logging/tracer.ts`, `package.json`). No OTel.
- Operator guidance is one line: "To view more logging for troubleshooting
  set `LOG_LEVEL=debug`"; optional Sentry via `SENTRY_DSN`
  (https://docs.getoutline.com/s/hosting/doc/troubleshooting-HXckrzCqDJ;
  `.env.sample`).

### Gitea (go-gitea/gitea @ main) / Forgejo (forgejo/forgejo @ forgejo)

- Custom logging module (`modules/log/`), **plaintext only — no JSON
  application-log output exists** (no json writer among the 28 files in
  `modules/log/`, none in docs or `custom/conf/app.example.ini`); writers:
  console (stdout/stderr), file, conn
  (https://docs.gitea.com/administration/logging-config). Forgejo: identical.
- Level via `[log] LEVEL` (default `Info`; canonical values in
  `modules/log/level.go` — the three docs sources disagree, source is
  authoritative); env override convention `GITEA__log__LEVEL`
  (Forgejo: `FORGEJO__log__LEVEL`); per-writer LEVEL/FLAGS/EXPRESSION,
  separate access/router/xorm sub-loggers
  (https://docs.gitea.com/administration/config-cheat-sheet).
- `GET /api/healthz` checks DB ping + cache ping, JSON
  `{status, checks…}` body, HTTP 424 on fail
  (`routers/web/healthcheck/check.go`, `routers/web/web.go`); k8s docs
  recommend it as a **liveness** probe with generous thresholds
  (https://docs.gitea.com/installation/install-on-kubernetes). Notably the
  source + Dockerfile warn: "this health check should NEVER be used as a
  'restart' trigger, for example: Docker's HEALTHCHECK" (migrations would
  cause restart loops) — the official image ships no HEALTHCHECK.
- Prometheus shipped in core, `[metrics] ENABLED` default false, optional
  scrape bearer `TOKEN` (`modules/setting/metrics.go`; conditional route
  registration in `routers/web/web.go`). Forgejo: functionally identical.
- OTel absent in both. Gitea's "tracing" is an internal in-memory span ring
  for the admin UI, no exporter (`modules/gtprof/`). Forgejo merged an OTel
  integration on 2024-08-05 (PR 3972) and **reverted it two days later**
  (commit `2e2a0444`); nothing shipped today.
- Alerting: only the Enterprise HA doc says scrape `/metrics` and alert on
  queue depth / error rates; community docs have no monitoring page
  (https://docs.gitea.com/enterprise/installation/high-availability).

### PostHog — hobby self-host (PostHog/posthog @ master)

- Django: structlog with formatter selected by `LOGGING_FORMATTER_NAME` —
  **default is the console renderer, JSON only if set to `json`**
  (`posthog/settings/logs.py`). plugin-server (Node): pino — plain JSON in
  prod ("so we can easily ingest into Loki"), pino-pretty otherwise
  (`nodejs/src/common/utils/logger.ts`; pino ^8.6.0 in `nodejs/package.json`).
- Levels: `DJANGO_LOG_LEVEL` (Django), `LOG_LEVEL` (plugin-server),
  `RUST_LOG` (Rust sidecars, set inline in compose). None surfaced in the
  self-host docs.
- Health: `/_livez` (no checks) + `/_readyz` (Postgres/ClickHouse/broker/
  cache/kafka, role-scoped via `?role=`), legacy `/_health`
  (`posthog/health.py`, `posthog/urls.py`); Node services `/_health`,
  `/_ready` (`nodejs/src/common/api/router.ts` L38–39). Built for k8s probes
  per the source header — the hobby compose defines **no healthcheck for
  web/worker/Node services**, only infra + Rust sidecars
  (`docker-compose.base.yml`, `docker-compose.hobby.yml`).
- Prometheus instrumented everywhere (Node `/_metrics` + `/metrics`; Django
  multiprocess exporter on port 8001; Rust `METRICS_PORT`), but **nothing in
  the hobby stack scrapes or even publishes those ports**.
- OTel shipped in the Django app (`posthog/otel_instrumentation.py`) and
  **explicitly disabled in hobby**: `OTEL_SDK_DISABLED: 'true'`,
  empty OTLP endpoint (`docker-compose.hobby.yml`).
- Self-host stance: "officially unsupported"; operator guidance = check
  containers are running and read their logs (https://posthog.com/docs/self-host).

### Supabase — docker self-host (supabase/supabase docker/ @ master)

- Per-service JSON to stdout: GoTrue = logrus with JSON formatter
  (`supabase/auth: internal/observability/logging.go`); Storage = pino with
  optional pino-logflare shipping (`supabase/storage:
  src/internal/monitoring/logger.ts`); Realtime = Elixir Logger; Kong access
  log routed to `/dev/stdout` in compose.
- Levels: `GOTRUE_LOG_LEVEL` (`supabase/auth: internal/conf/logging.go`),
  `LOG_LEVEL` default `info` (storage `src/config.ts` L522; realtime
  `config/runtime.exs` L61), `PGRST_LOG_LEVEL` default `error`
  (https://docs.postgrest.org/en/stable/references/configuration.html).
  None documented in the self-hosting guide.
- **Every service in `docker/docker-compose.yml` carries a healthcheck**:
  GoTrue `GET :9999/health`, PostgREST `postgrest --ready` (admin server
  also exposes `/live` + `/ready` per
  https://docs.postgrest.org/en/stable/references/admin_server.html),
  Storage `GET :5000/status`, Realtime tenant-scoped JWT-authed `/health`,
  Kong `kong health`, db `pg_isready`. The docs' success criterion is "all
  services … `(healthy)`" (https://supabase.com/docs/guides/self-hosting/docker).
- Prometheus: live-by-default only on Realtime + Supavisor (JWT-authed
  `/metrics`, `METRICS_JWT_SECRET` set in compose); GoTrue
  (`GOTRUE_METRICS_ENABLED`) and Storage (`PROMETHEUS_METRICS_ENABLED`)
  opt-in and off in compose; no scraper ships.
- OTel: shipped per-service (GoTrue `GOTRUE_TRACING_ENABLED`; Storage boots
  `otel-tracing` unconditionally with exporter env-configured), but
  unconfigured in the shipped compose. PostgREST OTel support UNVERIFIED.
- Log aggregation is an opt-in overlay: "Logs & Analytics are not included in
  the default configuration to reduce the memory footprint" —
  `./run.sh config add logs` adds Vector + Logflare
  (`docker/docker-compose.logs.yml`). First-party Grafana repo
  `supabase/supabase-grafana` exists but its README warns it "is an example
  and is not intended for production use".

## Our stack: pino, Hono, graphile-worker

### pino (not yet a dependency here)

- Current major: **pino 10** (10.3.1 on npm, https://registry.npmjs.org/pino/latest).
- Default output: newline-delimited JSON to `pino.destination(1)` (STDOUT),
  standard fields `level`, `time`, `pid`, `hostname`, `msg`
  (https://github.com/pinojs/pino/blob/main/docs/api.md).
- `redact`: paths in JS dot/bracket notation with wildcards (`a.b.*`,
  `a[*].b`, `a["b-c"].d`); `censor` = static string (default `"[Redacted]"`)
  or `(value, path) => …` function; `remove: true` drops the key entirely.
  ~2% overhead for static paths, wildcards cost real CPU; paths must be
  hardcoded config, never user input
  (https://github.com/pinojs/pino/blob/main/docs/redaction.md).
- Redaction operates on logged **object keys** — it does not scrub
  interpolated message strings; secrets must be passed as fields, not baked
  into `msg` (implication of the path-based design, same doc).
- No built-in env-var level support — `level: env.LOG_LEVEL ?? "info"` is a
  user pattern, set at init or via the `logger.level` accessor
  (https://github.com/pinojs/pino/blob/main/docs/api.md).
- pino-pretty: "a basic ndjson formatter to be used in **development**";
  the README says "We recommend against using `pino-pretty` in production
  and highly recommend installing `pino-pretty` as a development
  dependency", used by piping (`node app.js | pino-pretty`) or a dev-only
  transport (https://github.com/pinojs/pino-pretty; pino docs
  https://github.com/pinojs/pino/blob/main/docs/pretty.md: NDJSON is
  "perfect for production usage … not so great for development").

### Hono + pino

- Hono's built-in `logger` middleware is **plaintext** (method, path, status,
  elapsed time, ANSI-colored) — fine for dev, not structured
  (https://hono.dev/docs/middleware/builtin/logger).
- The officially listed pino integration is **hono-pino**
  (https://hono.dev/docs/middleware/third-party under Monitoring/Tracing:
  "Pino logger" → github.com/maou-shonen/hono-pino). It logs per-request
  `method`, `url`, `status`, `responseTime` (ms), auto-generated `reqId`,
  exposes the logger as `c.var.logger`, supports `assign()` for
  per-request bindings. **Caveat: its README declares "security-only
  maintenance mode"** (v0.10.3, Oct 2025), recommending LogLayer for new
  projects (https://github.com/maou-shonen/hono-pino).
- Standard request-log field set across hono-pino / our existing access
  log: method, path/url, status, duration ms, request id. Our
  `packages/api/src/routes/authz.ts` `logAccess` already emits exactly this
  shape as JSON (`{evt, method, path, status, durationMs, decision,
  repoId?, reviewerId?}` via `console.info(JSON.stringify(line))`) — the
  "D9 log contract". Hand-rolling on that pattern is a live option given
  hono-pino's maintenance status.
- Repo pins: `hono ^4.9.10`, locked **4.12.27** (`packages/api/package.json`,
  `pnpm-lock.yaml`).

### graphile-worker logger boundary

Repo pins `graphile-worker ^0.16.6`, locked **0.16.6**
(`packages/worker/package.json`, `pnpm-lock.yaml`); everything below was
verified against the v0.16.6 source tag or the library docs.

- The boundary is the `logger` option to `run()`: `new Logger(logFactory)` where
  the `Logger` abstraction comes from **@graphile/logger**. `logFactory(scope)`
  returns `(level, message, meta?) => void`; levels are
  `error | warning | info | debug`; scope fields: `label` (`"worker"` or
  `"job"`), `workerId`, `taskIdentifier`, `jobId`
  (https://worker.graphile.org/docs/library/logger). Mapping this onto a
  pino child logger (`scope` → bindings, `meta` → merge object) is a
  ~15-line adapter.
- Default logger: console output, `debug` suppressed unless
  `GRAPHILE_LOGGER_DEBUG=1`; some messages additionally gated behind
  `GRAPHILE_ENABLE_DANGEROUS_LOGS=1` (may leak credentials — keep off in
  prod) (same docs page).
- **Job lifecycle logging that comes free** (graphile/worker `src/worker.ts`
  @ v0.16.6):
  - job pickup: `logger.debug("Found task <id> (<task_identifier>)")`;
  - success: `logger.info("Completed task <id> (<task>, <ms>ms…) with
    success", { job, duration, success: true })` — includes attempt count
    when it was a retry;
  - failure: `logger.error("Failed task <id> (<task>, <ms>ms, attempt <n>
    of <max>) with error …", { failure: true, job, error, duration })`;
  - there is **no separate retry event** — a failure log with
    `attempt n of max` is the retry signal (rescheduling happens in
    `failJob()` without its own log line).
- Inside tasks, `helpers.logger` is the pre-scoped logger
  (`error/warn/info/debug(message, meta?)`) carrying
  `{label: "job", workerId, taskIdentifier, jobId}` — so task-level logs
  correlate to the job for free once the custom logger is injected
  (https://worker.graphile.org/docs/library/logger).

## Repo grounding — ticket-claim verification

- **"Bare console.* in worker/api/web-server" — TRUE, with one nuance.**
  Worker: 5 `console.error` sites in `packages/worker/src/main.ts` (boot
  messages, fatal handler, and the injected `log` boundary
  `(message) => console.error("[worker] " + message)` passed to
  `createGenerator`/`createGenerateTask`). API: `console.error` in
  `packages/api/src/routes/{webhook,conversation,inline-comment,authz}.ts`.
  Web server: `console.error("webhook app composition failed", …)` in
  `apps/web/src/server.ts:58`. **Nuance/drift:** the API's read-path access
  log is already *structured JSON on stdout* —
  `packages/api/src/routes/authz.ts` `logAccess()` emits
  `console.info(JSON.stringify({evt: "read", method, path, status,
  durationMs, decision, repoId?, reviewerId?}))` (the "D9 log contract").
  So the api tier is not uniformly unstructured; the gap is a shared logger
  + levels + redaction, not the absence of any structured logging.
- **"GET /api/version doubles as CLI liveness probe" — TRUE.**
  `packages/api/src/routes/version.ts` says it verbatim: "it doubles as the
  CLI's cheapest authenticated liveness probe"; consumed by
  `packages/cli/src/program.ts` `probeServer()` (reachable/authenticated/
  version tri-state). Note it sits behind `sessionLayer` — it is an
  *authenticated* probe, unusable as an orchestrator/LB health endpoint,
  which every surveyed project keeps unauthenticated (Supabase's Realtime
  JWT-authed `/health` being the lone exception).
- **Compose healthchecks** (`docker-compose.yml`): postgres = `pg_isready`
  (L23–27); web = `wget -qO /dev/null http://127.0.0.1:3000/` (L51–56) —
  probing `/`, i.e. the SSR page, not a dedicated endpoint; worker =
  **none by design**, comment at L76–78: "No HTTP surface to probe;
  liveness = the runner process itself" + restart-on-crash.
- Worker boot/shutdown flow for future log points:
  `packages/worker/src/runner.ts` (migrations → `run()`; graphile owns
  SIGTERM/SIGINT + `helpers.abortSignal`) and `packages/worker/src/main.ts`
  (startup wiring, the one place env is read — a logger would be
  constructed here and injected, per `packages/worker/AGENTS.md`
  "Env is injected").

## Grill pre-answers (evidence-decided)

- **Does the worker need an HTTP health surface? Evidence says no for v1.**
  Norms: PostHog's hobby compose gives its workers no healthcheck; n8n's
  queue-mode workers get a health server only behind opt-in
  `QUEUE_HEALTH_CHECK_ACTIVE=true`; Plausible's app container ships without
  a healthcheck; Gitea's source explicitly warns against restart-trigger
  healthchecks. Our compose's "liveness = the runner process itself +
  restart: on crash" stance is squarely inside the surveyed norm. If/when
  k8s readiness matters, the n8n pattern (tiny opt-in HTTP listener) is the
  precedent.
- **What does graphile-worker give free?** Job pickup (debug), success
  (info, with `{job, duration, success}`), failure (error, with
  `{failure, job, error, duration}` and `attempt n of max` in the message),
  and a pre-scoped `helpers.logger` (`workerId`/`taskIdentifier`/`jobId`)
  inside tasks — all surfaced through one injected
  `new Logger(logFactory)`. No distinct retry event exists; treat
  failure-with-attempts as the retry signal. (Sources in the graphile
  section above; verified at v0.16.6, the locked version.)
- **Redaction mechanics:** pino `redact` with hardcoded dot/bracket paths +
  wildcards, `censor`/`remove` — cheap for static paths, but it only
  scrubs *fields*; the convention that secrets ride as structured fields
  (never interpolated into `msg`) has to be a code standard, matching the
  repo's existing rule "Error messages never carry secrets, tokens, or
  connection strings" (root `CLAUDE.md`). Outline's prod `sanitize()` and
  Cal.com's tslog `maskValuesOfKeys` are the same pattern in the cohort.
- **Does v1 need Prometheus or OTel? No.** 0/7 projects scrape metrics in
  their default self-host deploy; 2/7 (Outline, Cal.com) ship no Prometheus
  at all; OTel is absent (4), reverted (Forgejo), vendor-gated (Plausible),
  or shipped-but-disabled-by-default (n8n, PostHog, Supabase). The
  evidence-backed v1 bar is: JSON stdout logs + `LOG_LEVEL` + an
  unauthenticated liveness (and, for the web tier, readiness-with-DB)
  endpoint. Prometheus, if ever, follows the cohort shape: off-by-default
  flag, optional bearer token (Gitea's `[metrics] TOKEN`).
- **Health endpoint naming:** no single winner, but the liveness/readiness
  *split* is the norm among ops-mature Node/py products (`/healthz` +
  `/healthz/readiness`, `/_livez` + `/_readyz`, `/live` + `/ready`);
  single-endpoint-with-DB-check (Outline, Gitea) is the simpler minority
  variant. Whatever the path, every project keeps it unauthenticated and
  outside the app's auth stack — unlike our current authenticated
  `/api/version`.

**Left as judgment calls for Idan** (evidence narrows but does not decide):
event taxonomy specifics (which domain events get first-class `evt` names
beyond the existing `evt: "read"` contract); correlation-id shape (adopt
hono-pino's `reqId` vs our own id minted at the edge, and whether job logs
carry the PR/generation id as the correlation key); hono-pino vs hand-rolled
middleware (maintenance-mode caveat vs free `reqId`/bindings); exact health
endpoint paths and whether the web healthcheck moves off `/`; docs scope
(the cohort ranges from zero operator docs (Plausible, Cal.com) to a full
monitoring page (n8n) — where MergeBrief's self-host docs land is a
positioning choice).

## Sources

Primary docs/source consulted (all fetched 2026-07-20; source refs pinned to
the branch/tag named in each section):

- 12factor: https://12factor.net/logs
- Plausible: https://raw.githubusercontent.com/plausible/analytics/master/config/runtime.exs · …/mix.exs · `lib/plausible_web/router.ex` · `lib/plausible_web/endpoint.ex` · `lib/plausible/prom_ex.ex` · https://github.com/plausible/community-edition (compose.yml, wiki Home/Configuration) · https://prom-ex.hexdocs.pm/PromEx.Plug.html
- Cal.com: calcom/cal.com @ f004349 — `packages/lib/logger.ts`, `packages/lib/constants.ts`, `apps/api/v2/src/lib/logger.ts`, `apps/api/v2/src/app.controller.ts`, `apps/web/instrumentation.ts`, `.env.example` · calcom/docker `docker-compose.yaml` · calcom/docs self-hosting tree
- n8n: n8n-io/n8n @ master — `packages/@n8n/backend-common/src/logging/logger.ts`, `packages/@n8n/config/src/configs/logging.config.ts`, `packages/@n8n/config/src/configs/endpoints.config.ts`, `packages/cli/src/abstract-server.ts`, `packages/cli/package.json` · docs.n8n.io: …/use-environment-variables/logs, …/keep-n8n-running/monitor-n8n, …/visualize-metrics-with-grafana, …/trace-executions-with-opentelemetry, …/set-up-logging
- Outline: outline/outline @ main — `server/logging/Logger.ts`, `server/logging/tracer.ts`, `server/main.ts`, `Dockerfile`, `.env.sample`, `package.json` · docs.getoutline.com/s/hosting (docker, troubleshooting)
- Gitea: go-gitea/gitea @ main — `modules/log/` (incl. `level.go`), `modules/setting/metrics.go`, `modules/gtprof/`, `routers/web/web.go`, `routers/web/healthcheck/check.go`, `cmd/manager.go`, `Dockerfile`, `custom/conf/app.example.ini`, `go.mod` · docs.gitea.com: logging-config, config-cheat-sheet, install-with-docker, install-on-kubernetes, enterprise/installation/high-availability
- Forgejo: forgejo/forgejo @ forgejo — `routers/web/web.go`, `Dockerfile`, `custom/conf/app.example.ini`, `go.mod`, `modules/opentelemetry` history (PR 3972, revert `2e2a0444`) · forgejo.org/docs/latest: admin/logging-documentation, admin/installation-docker, admin/config-cheat-sheet
- PostHog: PostHog/posthog @ master — `posthog/settings/logs.py`, `posthog/settings/metrics.py`, `posthog/health.py`, `posthog/urls.py`, `posthog/otel_instrumentation.py`, `nodejs/src/common/utils/logger.ts`, `nodejs/src/common/api/router.ts`, `nodejs/package.json`, `docker-compose.base.yml`, `docker-compose.hobby.yml`, `bin/docker-server-unit`, `bin/docker-worker-celery` · https://posthog.com/docs/self-host
- Supabase: supabase/supabase @ master — `docker/docker-compose.yml`, `docker/docker-compose.logs.yml` · supabase/auth @ master — `internal/observability/logging.go`, `internal/conf/{logging,configuration,metrics,tracing}.go`, `example.env` · supabase/storage @ master — `src/internal/monitoring/logger.ts`, `src/config.ts`, `src/app.ts`, `src/admin-app.ts`, `src/start/server.ts` · supabase/realtime @ main — `config/runtime.exs`, `OBSERVABILITY_METRICS.md` · supabase/supavisor README · https://supabase.com/docs/guides/self-hosting/docker · https://docs.postgrest.org/en/stable/references/{configuration,admin_server}.html · https://github.com/supabase/supabase-grafana
- pino: https://github.com/pinojs/pino/blob/main/docs/api.md · …/docs/redaction.md · …/docs/pretty.md · https://registry.npmjs.org/pino/latest · https://github.com/pinojs/pino-pretty
- Hono: https://hono.dev/docs/middleware/builtin/logger · https://hono.dev/docs/middleware/third-party · https://github.com/maou-shonen/hono-pino
- graphile-worker: https://worker.graphile.org/docs/library/logger · https://raw.githubusercontent.com/graphile/worker/v0.16.6/src/worker.ts
- This repo: `packages/worker/{AGENTS.md,package.json,src/main.ts,src/runner.ts}` · `packages/api/src/routes/{version,authz,webhook,conversation,inline-comment}.ts` · `packages/cli/src/program.ts` · `apps/web/src/server.ts` · `docker-compose.yml` · `pnpm-lock.yaml`
