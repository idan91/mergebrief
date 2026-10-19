# 0046: OpenTelemetry tracing, off by default

Status: accepted (2026-10-18). Supersedes ADR 0034 #6 in part (the job
payload now carries one optional correlation field) and #8 in part (OTel
tracing is no longer out of scope; Prometheus, in-app log transports and
telemetry back to us still are).

An Operator can send traces to their own backend, Datadog, Grafana,
Honeycomb or any OTLP endpoint, by setting one endpoint. With no endpoint
set, a process loads no OTel SDK, exporter or instrumentation; only the
no-op `@opentelemetry/api` is present. "OTel span" below names a tracing
span, never the domain's **Span diff** or **Sibling span**.

## Context

- ADR 0034 made correlated logs the v1 trace and parked OTel as
  "adopter-local, off-by-default, demand-triggered", citing Forgejo's OTel
  work reverted two days after it landed.
- The owner decided, in the BRIEF-336 grill, that a self-hoster must be
  able to plug in an existing backend, Datadog first, before the first
  Release. Logs already reach any backend through container stdout;
  traces had no path.
- One push crosses three processes and a queue: the web tier, the api, the
  graphile job, the worker's calls to GitHub and the model provider. Logs
  join them on `reqId`, `deliveryId` and `{prId, headSha}`; a trace shows
  the same story as one timeline.

## Considered options

- Vendor SDKs (`dd-trace` and kin): one vendor per adapter, rejected.
- OpenTelemetry with OTLP export only: every backend above accepts it.
- `@opentelemetry/sdk-node`: it builds its exporters, propagators and
  instrumentations from `OTEL_*` on its own, outside the composition root,
  and pulls exporters we do not ship. Rejected for the manual tracer
  provider. The OTLP exporter still honours the compression,
  certificate and header variables it reads itself; the parsed config
  decides the endpoint, the sampler and whether tracing runs at all.
- Browser OTel spans: they need a public collector endpoint and send data
  from users' browsers, rejected.
- The worker's job span as a child of the push trace: a later push replaces
  the queued job (`job_key` replace), so one job can serve several pushes,
  rejected for a span link.

## Decision

1. **OTel SDK, OTLP export, off by default.** No endpoint means the SDK,
   the exporter and the instrumentations are never imported, so the
   Forgejo failure mode (a default-on SDK in every deploy) cannot happen.
   Configuration is the standard `OTEL_*` variables, read by each
   process's `src/instrument.ts`: a preload that runs before the main
   composition root, so instrumentation patches modules before they load.
   Sampling is 100% by default; the Operator overrides it with
   `OTEL_TRACES_SAMPLER`.
2. **The trace starts at the web server.** Each inbound request opens the
   root OTel span; an inbound `traceparent` from the Operator's reverse
   proxy is continued. Web sends `traceparent` on the proxied call and on
   every SSR read, and the api continues the trace.
3. **First-cut spans**: auto-instrumented inbound and outbound HTTP
   (`http`, `undici`) and Postgres (`pg`), plus one OTel span per graphile
   job. Finer spans wait for a reader who needs them. Three limits keep
   the volume and the content honest: `/healthz` and `/readyz` open no
   OTel span (a probe every 15s is not traffic); a `pg` query opens one
   only under a parent, so graphile's idle polling starts no trace; and
   every URL attribute drops its query string, because the OAuth callback
   carries `code` and `state` there. The client's address and user agent,
   which the http instrumentation reads from headers, are redacted; the
   host it reads for `server.address` is the only other header recorded. Bound SQL values are never recorded, though a
   failed query's span keeps Postgres's error message, which can quote one.
4. **The queue hop is a link.** `GenerateJobPayload` gains an optional
   `traceparent` under the additive payload rule; the worker's job span
   starts its own trace with a span link to the enqueue.
5. **Logs carry the trace.** While an OTel span is active, every log line
   gains `trace_id` and `span_id`, added once at the `packages/logging`
   boundary. `reqId` stays: it exists with tracing off and keys the audit
   row.
6. **The bootstrap lives at `logging/tracing`.** All three processes
   already depend on `packages/logging`, and ADR 0034 named its `Logger`
   as the seam a later OTel addition would use. No new package.
7. **Shutdown flushes within the existing budget.** Each process stops
   tracing after its own drain, and the flush is raced against a fixed
   budget so an unreachable collector never holds a stop past
   `stop_grace_period`.

## Consequences

- The Image ships the OTel packages; a process with no endpoint loads only
  the no-op API.
- `observability.md` gains a Datadog recipe (the Agent's OTLP receiver
  plus docker log collection) and a generic OTLP collector recipe, and
  `docker-compose.tracing.yml` runs a local Jaeger for development.
- Adding `trace_id` and `span_id` to log lines is additive to the
  documented line shape, not a breaking change.
- An inbound `traceparent` is client-controlled until the Operator's proxy
  strips or rewrites it. It only decides which trace a request joins and
  grants nothing, so it is continued as is.
- Each app gains a second composition root, `src/instrument.ts`, that
  reads telemetry config only; its member `AGENTS.md` names it.
