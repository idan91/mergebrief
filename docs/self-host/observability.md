# Observability

Everything the instance emits is **structured JSON on stdout**: one line
per event, no files, no telemetry back to anyone. Rotation and shipping are
your side of the contract (12-factor); this page documents the line shape,
the stable event vocabulary, the health endpoints, and worked recipes for
Grafana/Loki, Datadog, and CloudWatch. Traces are optional and off by
default: set one OTLP endpoint and every process sends them to your own
backend ([Tracing](#tracing)).

## The log line

```json
{"level":"info","time":1784667468255,"pid":42,"hostname":"3f9c2a1b7d4e","reqId":"7f0b…","evt":"api.access","method":"GET","path":"/api/inbox","status":200,"durationMs":12,"decision":"200","msg":"request"}
```

- `level`: string label: `error`, `warn`, `info`, `debug`.
- `msg`: human-readable message. Secrets never ride here (or anywhere:
  sensitive fields are removed at the logger, not masked; a redacted key
  is simply absent). Three things are masked in place inside `msg` or a
  serialized `err`/`error` field, each with a greppable marker. A
  URL-shaped substring becomes `[redacted-url]` (`file://` stack frames
  are exempt). A credential-shaped token, or the value after `password=`,
  becomes `[redacted-token]`. The values a failed database query bound
  are cut and the statement stays: a query error loses them outright, and
  a message that only quotes one shows `[redacted-params]`. A failed job's line
  carries the first line of its error message and of each cause under it, so
  a failed query reads as its statement and then the database's reason,
  never the error itself.
- `evt`: present only on the first-class events below. Everything else
  (boot/shutdown, graphile lifecycle, progress lines) is plain leveled
  logging with no `evt`; grep and alert on `evt` and levels, not on `msg`
  text.
- `trace_id`, `span_id`: present only while tracing is on and the line is
  written inside an OTel span: the 32- and 16-hex ids of the trace and span
  it belongs to, under the OTel log data model's names, which Datadog's log
  pipeline detects on its own. A line outside any span, and every line with
  tracing off, carries neither.
- `LOG_LEVEL` env picks the threshold (`error`/`warn`/`info`/`debug`,
  default `info`). Format is `NODE_ENV`-decided: JSON everywhere except
  `NODE_ENV=development`, which renders human-readable pino-pretty. The
  image ships no pino-pretty, so never set `NODE_ENV=development` on it: the
  logger cannot start. Need pretty output against a prod deploy? Pipe
  stdout through the `pino-pretty` CLI.

## Event vocabulary

These `evt` names are a **stable contract**: renames, removals, or field
changes get a breaking-change entry in
[`api-changelog.md`](../api-changelog.md); additions are non-breaking.

| `evt` | level | process | key fields | alert? |
|---|---|---|---|---|
| `webhook.verify.fail` | warn | api | `deliveryId`, `reqId` | on **sustained rate**: raw hits are internet scanner noise; a sustained rate after a secret rotation means webhook-secret drift |
| `webhook.dispatch.fail` | error | api | `deliveryId`, `reqId`, `err` | yes: a signed delivery failed to persist/enqueue |
| `webhook.delivery.duplicate` | debug | api | `deliveryId`, `reqId` | no: a signed pull request, review, check run or status delivery with a signature already processed in the last 72 hours was skipped; a GitHub manual redelivery of a successful delivery lands here |
| `job.fail` | error | worker | `prId`, `headSha`, `permanent`, `attempt`, `maxAttempts` | yes |
| `job.retries.exhausted` | error | worker | `prId`, `headSha`, `attempt`, `maxAttempts` | **THE worker alert**: the queue gave up on this job, or the head spent its claims and its row ends `failed` as `attempts-exhausted`. From the `sync-entry` job it means the PR's Entry comment may still not match its brief state |
| `provider.error` | error | worker | `provider`, `status`, `kind`, job bindings | 401/403 = credentials/config broken, alert now; `kind: provider-spend-limit` = the provider account reached a spend limit (the line carries no `status`), alert now; sustained 429/5xx = provider degraded |
| `token.refresh.fail` | error | api | `reqId`, `reviewerId`, `kind` | yes: a reviewer session or API token could not rotate its GitHub credentials. `kind` names GitHub's OAuth error (or `expiration-not-enabled`) when GitHub refused the App's own credentials or settings: fix the App, the session is kept. `kind: seal-failed` means GitHub rotated but the session key could not seal the new pair |
| `token.decrypt.fail` | error | api | `reqId`, `reviewerId` | yes: the session key cannot open a stored GitHub token, the access token on a request or the refresh token during a rotation. The session is kept and every request that needs GitHub answers 500 until the key matches the one that sealed it. A ciphertext moved from another grant row or column fails the same way ([Tokens at rest](./secrets.md#how-github-tokens-are-stored)) |
| `token.refresh.unavailable` | warn | api | `reqId`, `reviewerId`, `refreshTokenPossiblyConsumed` | on **sustained rate**: GitHub did not answer a token rotation within 10 seconds or answered with an outage, or another refresh held the same grant for over 2 seconds. Every session and token is kept and the request answers 502. `refreshTokenPossiblyConsumed: true` means GitHub may have rotated before the call failed, so a later `token.refresh.fail` retiring the same reviewer's grant can trace back to it |
| `authorization.revoked` | info | api | `deliveryId`, `reqId`, `reviewerId`, `sessions`, `tokens`, `grants` | no: a user revoked the App on github.com, and every session, API token and grant they held here was deleted |
| `grant.revoke.fail` | warn | api, worker | `reqId` (api only), `grantId`, `code` | on **sustained rate**: GitHub refused or did not answer a token revoke after a sign-out, an API token revoke or the hourly sweep deleting a dead grant, so that token may stay valid at GitHub until it expires. `code` is `token-delete-failed` (422, 5xx or no answer), or `credential-unreadable` when the session key no longer opens the stored token, or the worker runs without `SESSION_KEY_V1`. A 404 is not logged: GitHub answers it for a token it already invalidated and also for a wrong client secret, so a drifted secret surfaces through `token.refresh.fail` instead |
| `url-fallback-token.owner.fail` | error | api, worker | `status`, `code` | yes: GitHub refused `MERGEBRIEF_URL_FALLBACK_TOKEN` at boot (401, a 403 that is not a rate limit, or 404), so it serves nobody until the token is replaced and the process restarts |
| `audit.fail` | error | api | `reqId`, `operation`, `err` | yes: the action completed but its audit row never landed (data integrity) |
| `spend.cap.trip` | warn | worker | `repo`, `prId`, `headSha`, `cap`, `dayUtc`, plus `needed` and `left` for a large run | on **sustained rate**: the cap is working as configured, but the instance stuck at it produces no briefs all day |
| `generation.enqueue` | info | api | `deliveryId`, `reqId`, `repoId`, `prNumber`, `prId`, `headSha` | no: a webhook delivery added or replaced the PR's job; the line that joins a delivery to the worker's `{prId, headSha}` |
| `generation.start` | info | worker | `prId`, `headSha`, `waitMs`, `attempt` | no: the queue-wait line; pair with generation.complete for end-to-end time |
| `generation.complete` | info | worker | `kind`, `outcome`, `durationMs` | no: the model-call duration line; nothing else records how long a generation took. `outcome` is `succeeded`, `failed`, or `skipped` for a delta call cut at its output cap that stored a skip record instead |
| `generation.succeeded` | info | worker | `prId`, `headSha`, `prNumber`, `briefId` | no: the run finished; `briefId` is the brief it served |
| `generation.hold` | info | worker | `prId`, `headSha`, `kinds` | no: a trigger condition held the head before any claim; `kinds` lists the unmet condition kinds. A held head spends nothing and generates by itself once its conditions pass, or on a Generate click |
| `artifact.check.fail` | warn | worker | `kind`, `issueCount`, `firstPath`, job bindings | on **sustained rate**: a generated brief, delta brief or revision narrative failed its stored-shape check and was written anyway; `kind` is `brief`, `delta` or `revision-narrative`, the same values `generation.complete` carries, and no body content rides the line |
| `generator.tool-access` | warn | worker | `provider` | no: fires once at boot when the generator is `codex` or `cursor`, naming what that CLI can still reach (see "What stays open" in `generators.md`) |
| `generator.plain-http` | warn | worker | `host` | no: fires once at boot when `generator.baseUrl` is plain `http://` to a host other than the worker's own, so the API key and the pull request's code travel unencrypted |
| `link-fetch.public` | warn | worker | none | no: fires once at boot while `linkFetch.mode` is `public`, the default, in which the worker fetches any public link a pull request description holds; `off` or `allowlist` silences it |
| `jira.token.check` | warn; error when `outcome: refused` | worker | `outcome`, `site` | fires at most once at boot, when the config lists a `jira` context source and Atlassian refuses its API token or shows the token can do more than read. A check that gets no clear answer logs nothing, and no line does not prove the token holds `read:jira-work`. `outcome: refused` = yes: Atlassian refused the account email and API token, so every Jira read reports its ticket unread as `no-credential` until both variables are right and the worker restarts. `outcome: broader` = no: the token can do more than read issues, so replace it with an API token with scopes that holds `read:jira-work` only |
| `update.available` | info; warn when `security` | api | `current`, `latest`, `breaking`, `security`, `releaseNotesUrl` | warn: yes, a vulnerability fix exists. Fires once when `latest` is first newer than the running version, and once at boot if behind |
| `update.check.fail` | info on the first failure after boot, debug after | api | `err` | no; the network blocks github.com or the release file is malformed, and `/api/version` carries no fresh `checkedAt` |
| `db.version.upgrade` | info | api, worker | `from`, `to` | no; the one-row `instance_version` table moved forward at boot |
| `db.version.ahead` | warn | api, worker | `db`, `running` | yes: an older process booted under a database a newer one last recorded, a rollback; it keeps running |
| `api.access` | info; debug for a 2xx `GET /api/version`, the read the browser polls once a minute per visible tab | api | `method`, `path`, `status`, `durationMs`, `decision`, `operation`, `repoId`, `reviewerId`, `reqId` | no: this is the access log |

`api.access` is the per-request access line (numeric ids only, never a
token or cookie). `decision` is the auth gate's outcome; `status` is what
the handler returned; they differ when a handler fails after the gate
allowed the request. `operation` names the domain operation the request
routed to, and is what joins this line to the audit row that request wrote
(the audit ledger is a separate, never-purged store; see
[data-and-scaling.md](./data-and-scaling.md#query-the-audit-log)).

## Correlation

One push reads end to end in three steps:

1. **Delivery**: the web tier mints `X-Request-Id` for every request it
   receives, replacing any value the client sent, and sends it on the proxied
   call and on every read a page render makes. The api echoes it on every
   `/api` response, and every line for that request, web and api alike,
   carries it as `reqId`. Webhook lines additionally carry
   `deliveryId` (GitHub's `x-github-delivery`), which matches the delivery
   record in your GitHub App's **Advanced → Recent Deliveries** page.
2. **Enqueue**: when the delivery adds or replaces the PR's job, the api
   writes one `generation.enqueue` line carrying `deliveryId`, `reqId`,
   `repoId`, `prNumber`, `prId` and `headSha`. A delivery that queues nothing (a close, a stale
   redelivery, a head a stored brief already covers) writes none.
3. **Worker**: every worker line for the job (pickup, provider call,
   completion, failure) carries the same `{prId, headSha}`, ending at
   `generation.succeeded` with the stored `briefId`. Pushes coalesce into
   one pending job per PR, so several deliveries can share one job: filter
   the worker by the pair, never by a delivery. A later `generation.enqueue`
   for the same `prId` replaces the pending job, so an earlier pair's story
   ends at its own enqueue line.

`prId` is the instance's **internal pull-request row id, not the GitHub PR
number**. The same id (as `pull_request_id`) and `headSha` sit on the queue
row and the `generation` rows, so the log to database join is direct.

So the story of one push reads: `deliveryId` → `generation.enqueue` →
`{prId, headSha}` → `generation.succeeded`. With [tracing](#tracing) on,
the same story is two linked traces: the delivery's, and the job's, which
links back to it. Every line written inside either carries its `trace_id`.

## Tracing

Off by default. Set an OTLP/HTTP endpoint in `.env` and the api, the worker
and the web tier each send OpenTelemetry traces to it, protobuf over HTTP:

```sh
# .env
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

Run `docker compose up -d`, which recreates the services with the new
environment (`docker compose restart` keeps the old one), and each process
logs `tracing on` at boot. With no
endpoint set, a process loads no OpenTelemetry SDK at all.

What a trace holds:

- **One trace per web request.** It starts at the web tier, continuing a
  `traceparent` your reverse proxy sends, and follows the proxied call and
  every page render's reads into the api, down to each Postgres query.
- **One trace per job.** A worker job opens its own trace (`process
  generate`, `process recover-generation`, `process generate-large`,
  `process recover-generation-large`, `process sync-entry`, and the scheduled
  sweeps and `process reconcile-webhook-deliveries`) and carries the
  job's queries and its calls to GitHub and the model provider. It links to
  the trace that queued it: a delivery, a request such as a regenerate, or
  the job that re-queued it. The scheduled tasks start unlinked. It is a link
  and not a parent: a later push replaces a queued job, so the link points
  at the latest enqueue, and one job may serve several deliveries.
- **Not traced:** `/healthz`, `/readyz` and the web tier's static assets,
  and background calls that run outside any request or job.
- **Redacted:** URL query strings (the sign-in callback carries its code
  there), and the user agent and client address the http instrumentation
  reads from headers.
- **Never recorded:** any other request header but the host, cookies, SQL parameter
  values, and the text of a job's error. A failed query's span keeps
  Postgres's error message, which can quote a value.

Inside a trace, named spans mark the business steps, so a trace reads as
the flow and a monitor can key on a step. The names below are stable: a
rename is a breaking change, the same as an `evt` name. Their attributes
are ids, counts and decision tokens, never content.

| Span | Process | What it covers | Attributes |
| --- | --- | --- | --- |
| `<METHOD> <route>` | api | the request, named by its matched route, `POST /api/webhooks/github` | `http.route` |
| `<METHOD> /api/*`, `<METHOD> /*` | web | a proxied call, a page render | `http.route` |
| `<operation id>` | api | one product operation, `read-brief`, `submit-review`, its gate and handler | `mergebrief.operation` |
| `webhook.verify` | api | the delivery's signature check | `mergebrief.verified` |
| `webhook.dispatch` | api | the event's writes | `mergebrief.webhook.kind`, `mergebrief.webhook.action` |
| `generation.trigger` | api | the ingest transaction and its enqueue | `mergebrief.applied`, `mergebrief.queued`, `mergebrief.covered_by_brief`, `mergebrief.pr_id` |
| `authz.session` | api | the cookie or token lookup | `mergebrief.credential` |
| `authz.repo` | api | the repo access check | `mergebrief.cache_hit` |
| `authz.installation` | api | which installation holds the repo | |
| `pr.load` | api | the pull request row an operation reads | `mergebrief.found` |
| `github.publish_review`, `github.publish_comment` | api | a review or comment written to GitHub | `mergebrief.drafts` |
| `generation.open`, `generation.decide`, `generation.claim` | worker | the run's guards and first GitHub read, its decision, the daily-cap claim | `mergebrief.opened`, `mergebrief.decision`, `mergebrief.claim` |
| `generation.inputs`, `brief.generate`, `entry.ready` | worker | the files, diff and config; the brief; the ready Entry comment | |
| `generation.revision`, `generation.deltas`, `generation.finish` | worker | revision marks and narrative, the checkpoint deltas, the settled row | `mergebrief.deltas_written` |
| `chat <model>` | worker | one generation, its provider retries summed | `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `mergebrief.generation.kind`, `mergebrief.generation.effort`, `mergebrief.provider_requests` |
| `<store>.<method>` | api, worker | one persistence store call, `reviewSessions.preview`, `briefs.listForPullRequest`, `generationProjection.claimRun`; its queries nest under it | |

A store span is named for the method a caller reached and changes when
that method is renamed, so it is outside the stable contract above: key a
monitor on a business-step name instead.

Token counts come from the provider's own accounting. The API adapters, the
claude CLI and the cursor CLI report them; codex reports none. A CLI reports
once per run with the run's total, so for the two CLIs
`mergebrief.provider_requests` counts CLI runs, not the API requests inside
each. For Anthropic, OpenAI-compatible providers and the claude CLI the input
total counts cache reads and writes, as the GenAI convention defines it;
cursor's counts are exported as it reports them. With tracing on, an OpenAI-compatible provider is asked to
include usage in its stream; one that rejects the option is asked again
without it and reports no usage. With tracing off the request is unchanged.

| Variable | Default | Notes |
| --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset (off) | base URL; `/v1/traces` is appended |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | unset | full traces URL; wins over the base |
| `OTEL_EXPORTER_OTLP_HEADERS` | unset | `key=value,...`, URL-encoded values; api and worker only |
| `OTEL_RESOURCE_ATTRIBUTES` | unset | e.g. `deployment.environment=production` |
| `OTEL_TRACES_SAMPLER` | `parentbased_always_on` | any spec sampler; `parentbased_traceidratio` keeps a share |
| `OTEL_TRACES_SAMPLER_ARG` | `1` | the ratio, 0 to 1 |
| `OTEL_SDK_DISABLED` | unset | `true` turns tracing off with an endpoint set |

Only the `http/protobuf` protocol is supported; any other value, or an
endpoint that is not an http(s) URL, refuses boot with the variable named.
Leave `OTEL_SERVICE_NAME` unset: the processes name themselves
`mergebrief-web`, `mergebrief-api` and `mergebrief-worker`.

The web tier never receives the OTLP headers, so it holds no vendor key:
point it at a collector or agent you run beside the stack (both recipes
below do), and let that hold the key. The web tier also decides its own
sampling: it continues a caller's trace id but ignores the caller's sampled
flag. Under a ratio sampler that trace id still steers the decision, so a
client can push its own requests in or out of the sample; that costs you
volume, never data.

### Local Jaeger on a checkout

To try tracing on a checkout before you pick a backend, a throwaway local
Jaeger ships in the repository, not in a release.
`docker-compose.tracing.yml` runs it: the trace viewer on `127.0.0.1:16686`
and an OTLP/HTTP receiver on `4318`. It keeps traces in memory, so a restart
clears them. It is a development aid: a production instance sends traces to
its own backend, as the recipes below do.

With the compose stack, set `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318`
in `.env` and merge the file in:

```sh
docker compose -f docker-compose.yml -f docker-compose.tracing.yml up -d --wait
```

With the processes on the host (`pnpm app:host:prod`; `pnpm app:host` serves
the web tier through `vite dev`, which loads no tracing), set
`OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` and run it alone:

```sh
docker compose -f docker-compose.tracing.yml up -d
```

`vite dev` is untraced. The web tier traces only from `src/serve.ts`.

## Health endpoints

Two bare, **unauthenticated** top-level paths on **each** of the API and the
web tier, outside `/api`, no session or token interaction, constant tiny
JSON either way:

- `GET /healthz`: liveness on both. Static 200 `{"ok":true}` with zero
  dependencies; stays up even while the database is unreachable.
- `GET /readyz` on the **API**: readiness. 200 when one `SELECT 1`
  round-trips to Postgres; 503 `{"ok":false}` otherwise.
- `GET /readyz` on the **web tier**: 200 when it reaches the API's own
  `/readyz` within 2s. A web tier that cannot reach the API is not ready,
  even when its own process is fine.

Wire **restart policies and the compose healthcheck to `/healthz` only**:
a database blip must flip you out of the load balancer (`/readyz`), never
restart-churn either tier. `/api/version` is unrelated: it is the CLI's
authenticated liveness probe, not orchestrator health. It also carries
`latest`, the newest release the update check has seen, with
`releaseNotesUrl`, `checkedAt`, `breaking` and `security`; with the check
off or not yet succeeded it carries `version` alone
([upgrade.md](./upgrade.md#turn-off-or-mirror-the-update-check)). `dismissedVersion`,
when present, is the release the signed-in viewer dismissed the notice
for.

The **worker has no HTTP surface** by design (cohort norm): its liveness is
the process itself: compose runs it with `restart: on-failure`, so
transient crashes restart while a config error exits 0 and **stays down**:
look for `Exited (0)` in `docker compose ps -a` and the reason in
the last line of `docker compose logs worker`. The queue-level signal is
`job.retries.exhausted`.

## Log rotation

Compose ships `json-file` driver defaults on every service: `max-size:
10m`, `max-file: 3` (~30MB per service, bounded). If you ship logs off the
host (any recipe below), those defaults are still your local buffer; size
them to survive your shipper being down for as long as you care about.

## Recipe: Grafana + Loki

Promtail scrape (docker service discovery). Labels stay LOW-cardinality
(service only); everything else is queried from the JSON at read time:

```yaml
# promtail-config.yaml
scrape_configs:
  - job_name: docker
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
    relabel_configs:
      - source_labels: ["__meta_docker_container_label_com_docker_compose_service"]
        target_label: service
```

Useful LogQL over the `evt` contract:

```logql
# every first-class event, parsed (api and worker emit them; web emits none)
{service=~"api|worker"} | json | evt != ``

# the access log, slow requests only
{service="api"} | json | evt = `api.access` | durationMs > 1000

# a PR's internal row id (prId): read it off its generation.enqueue line
{service="api"} | json | evt = `generation.enqueue` | prNumber = `<pr-number>`

# one PR's whole worker-leg story, by that prId (not the PR number)
{service="worker"} | json | prId = `<internal-pr-row-id>`
```

Alert rules on the alert-worthy events:

```yaml
groups:
  - name: mergebrief
    rules:
      - alert: WorkerRetriesExhausted
        expr: sum(count_over_time({service="worker"} | json | evt = `job.retries.exhausted` [15m])) > 0
        labels: { severity: critical }
      - alert: ProviderAuthBroken
        expr: sum(count_over_time({service="worker"} | json | evt = `provider.error` | status =~ `401|403` [15m])) > 0
        labels: { severity: critical }
      - alert: ProviderSpendLimitReached
        expr: sum(count_over_time({service="worker"} | json | evt = `provider.error` | kind = `provider-spend-limit` [15m])) > 0
        labels: { severity: critical }
      - alert: WebhookVerifyFailSustained
        # sustained rate, not raw hits; scanners will trip a >0 rule daily
        expr: sum(rate({service="api"} | json | evt = `webhook.verify.fail` [30m])) > 0.05
        labels: { severity: warning }
      - alert: AuditWriteFailed
        expr: sum(count_over_time({service="api"} | json | evt = `audit.fail` [15m])) > 0
        labels: { severity: critical }
      - alert: SpendCapSustained
        # off only under spend.maxGenerationsPerDay: unlimited; an instance
        # pinned at the cap produces no briefs until 00:00 UTC
        expr: sum(count_over_time({service="worker"} | json | evt = `spend.cap.trip` [1h])) > 5
        labels: { severity: warning }
```

## Recipe: Datadog

Point the agent's docker log collection at the compose services; the JSON
lines auto-parse. Two settings matter: map `level` as the log status
remapper (string labels, not numbers), and facet `evt`. Monitors then key
off `@evt:job.retries.exhausted` (any occurrence),
`@evt:provider.error @status:(401 OR 403)` (any),
`@evt:provider.error @kind:provider-spend-limit` (any), and a rate-based monitor
on `@evt:webhook.verify.fail`.

Traces go to the same Agent through its OTLP receiver. Run it beside the
stack in `docker-compose.override.yml` and point every process at it; the
Agent holds the API key, so no process needs OTLP headers:

```yaml
# docker-compose.override.yml
services:
  datadog-agent:
    image: gcr.io/datadoghq/agent:7
    # Its own file, not .env: api and worker load .env, and the key is the
    # Agent's alone.
    env_file: ./.env.datadog
    environment:
      HOST_PROC: /proc
      DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_HTTP_ENDPOINT: 0.0.0.0:4318
      DD_LOGS_ENABLED: "true"
      DD_LOGS_CONFIG_CONTAINER_COLLECT_ALL: "true"
      # Only this stack's containers, not everything else on the host.
      DD_CONTAINER_EXCLUDE_LOGS: "name:.*"
      DD_CONTAINER_INCLUDE_LOGS: "image:^ghcr\\.io/idan91/mergebrief"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - /proc/:/host/proc/:ro
      - /sys/fs/cgroup/:/host/sys/fs/cgroup:ro
```

```sh
# .env.datadog
DD_API_KEY=<your-api-key>
DD_SITE=datadoghq.com

# .env
OTEL_EXPORTER_OTLP_ENDPOINT=http://datadog-agent:4318
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production
```

Datadog's log pipeline detects the OpenTelemetry `trace_id` and `span_id`
attributes on the JSON lines without a remapper, per its log and trace
correlation docs. Bring the Agent up with `docker compose up -d`.
`HOST_PROC: /proc` is not optional: without it the Agent's OTLP pipeline
fails at start with "process does not exist" and port 4318 never opens.

## Recipe: any OTLP backend

Grafana Cloud, Honeycomb, a self-hosted Tempo or Jaeger, or anything else
that accepts OTLP: run an OpenTelemetry Collector beside the stack and let
it hold the backend's credentials.

```yaml
# docker-compose.override.yml
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.140.0
    command: ["--config=/etc/otelcol/config.yaml"]
    # Its own file, not .env: api and worker load .env, and the backend's
    # credentials are the collector's alone.
    env_file: ./.env.otelcol
    volumes:
      - ./otelcol.yaml:/etc/otelcol/config.yaml:ro
```

```yaml
# otelcol.yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
processors:
  memory_limiter:
    check_interval: 1s
    limit_percentage: 80
    spike_limit_percentage: 25
  batch: {}
exporters:
  otlphttp:
    endpoint: ${env:OTLP_BACKEND_ENDPOINT}
    headers:
      Authorization: ${env:OTLP_BACKEND_AUTH}
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlphttp]
```

```sh
# .env.otelcol
OTLP_BACKEND_ENDPOINT=<your backend's OTLP/HTTP endpoint>
OTLP_BACKEND_AUTH=<the Authorization header value it expects>

# .env
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

Then `docker compose up -d` starts the collector and recreates the services.

Logs keep their own path (Loki, Datadog or CloudWatch above); every line
written inside a trace carries `trace_id` and `span_id` for the backend to
join on.

## Recipe: CloudWatch

Use the `awslogs` driver (or FireLens) per service instead of `json-file`
(rotation becomes retention policy on the log group). Metric filters over
the JSON, e.g. `{ $.evt = "job.retries.exhausted" }`, feed alarms with
threshold ≥ 1; give `webhook.verify.fail` a rate-style alarm (e.g. ≥ 20 in
30 minutes) rather than ≥ 1.
