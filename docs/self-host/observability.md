# Observability

Everything the instance emits is **structured JSON on stdout** — one line
per event, no files, no telemetry back to anyone. Rotation and shipping are
your side of the contract (12-factor); this page documents the line shape,
the stable event vocabulary, the health endpoints, and worked recipes for
Grafana/Loki, Datadog, and CloudWatch.

## The log line

```json
{"level":"info","time":1784667468255,"pid":42,"hostname":"web-1","reqId":"7f0b…","evt":"api.access","method":"GET","path":"/api/inbox","status":200,"durationMs":12,"decision":"200","msg":"request"}
```

- `level` — string label: `error`, `warn`, `info`, `debug`.
- `msg` — human-readable message. Secrets never ride here (or anywhere:
  sensitive fields are removed at the logger, not masked — a redacted key
  is simply absent). One exception is masked in place: URL-shaped
  substrings inside `msg` or a serialized `err`/`error` field are replaced
  with the greppable marker `[redacted-url]` (`file://` stack frames are
  exempt).
- `evt` — present only on the first-class events below. Everything else
  (boot/shutdown, graphile lifecycle, progress lines) is plain leveled
  logging with no `evt`; grep and alert on `evt` and levels, not on `msg`
  text.
- `LOG_LEVEL` env picks the threshold (`error`/`warn`/`info`/`debug`,
  default `info`). Format is `NODE_ENV`-decided: JSON everywhere except
  `NODE_ENV=development`, which renders human-readable pino-pretty. Need
  pretty output against a prod deploy? Pipe stdout through the
  `pino-pretty` CLI.

## Event vocabulary

These `evt` names are a **stable contract**: renames, removals, or field
changes get a breaking-change entry in
[`api-changelog.md`](../api-changelog.md); additions are non-breaking.

| `evt` | level | process | key fields | alert? |
|---|---|---|---|---|
| `webhook.verify.fail` | warn | api | `deliveryId`, `reqId` | on **sustained rate** — raw hits are internet scanner noise; a sustained rate after a secret rotation means webhook-secret drift |
| `webhook.dispatch.fail` | error | api | `deliveryId`, `reqId`, `err` | yes — a signed delivery failed to persist/enqueue |
| `job.fail` | error | worker | `prId`, `headSha`, `permanent`, `attempt`, `maxAttempts` | yes |
| `job.retries.exhausted` | error | worker | `prId`, `headSha`, `attempt`, `maxAttempts` | **THE worker alert** — the queue gave up on this job, or the head spent its claims and its row ends `failed` as `attempts-exhausted` |
| `provider.error` | error | worker | `provider`, `status`, `kind`, job bindings | 401/403 = credentials/config broken, alert now; sustained 429/5xx = provider degraded |
| `token.refresh.fail` | error | api | `reqId`, `reviewerId` | yes — a reviewer session or API token could not rotate its GitHub credentials |
| `url-box-token.owner.fail` | error | api, worker | `status`, `code` | yes: GitHub refused `MERGEBRIEF_URL_BOX_TOKEN` at boot (401, a 403 that is not a rate limit, or 404), so it serves nobody until the token is replaced and the process restarts |
| `audit.fail` | error | api | `reqId`, `operation` | yes — the action completed but its audit row never landed (data integrity) |
| `spend.cap.trip` | warn | worker | `repo`, `prId`, `headSha`, `cap`, `dayUtc` | on **sustained rate** — the cap is working as configured, but the instance stuck at it produces no briefs all day |
| `generation.enqueue` | info | api | `deliveryId`, `reqId`, `repoId`, `prNumber`, `prId`, `headSha` | no: a webhook delivery added or replaced the PR's job; the line that joins a delivery to the worker's `{prId, headSha}` |
| `generation.start` | info | worker | `prId`, `headSha`, `waitMs`, `attempt` | no: the queue-wait line; pair with generation.complete for end-to-end time |
| `generation.complete` | info | worker | `kind`, `outcome`, `durationMs` | no — the model-call duration line; nothing else records how long a generation took |
| `generation.succeeded` | info | worker | `prId`, `headSha`, `prNumber`, `briefId` | no: the run finished; `briefId` is the brief it served |
| `artifact.check.fail` | warn | worker | `kind`, `issueCount`, `firstPath`, job bindings | on **sustained rate**: a generated brief, delta brief or revision narrative failed its stored-shape check and was written anyway; `kind` is `brief`, `delta` or `revision-narrative`, the same values `generation.complete` carries, and no body content rides the line |
| `update.available` | info; warn when `security` | api | `current`, `latest`, `breaking`, `security`, `releaseNotesUrl` | warn: yes, a vulnerability fix exists. Fires once when `latest` is first newer than the running version, and once at boot if behind |
| `update.check.fail` | info on the first failure after boot, debug after | api | `err` | no; the network blocks github.com or the release file is malformed, and `/api/version` carries no fresh `checkedAt` |
| `db.version.upgrade` | info | api, worker | `from`, `to` | no; the one-row `instance_version` table moved forward at boot |
| `db.version.ahead` | warn | api, worker | `db`, `running` | yes: an older process booted under a database a newer one last recorded, a rollback; it keeps running |
| `api.access` | info; debug for a 2xx `GET /api/version`, the read the browser polls once a minute per visible tab | api | `method`, `path`, `status`, `durationMs`, `decision`, `operation`, `repoId`, `reviewerId`, `reqId` | no — this is the access log |

`api.access` is the per-request access line (numeric ids only, never a
token or cookie). `decision` is the auth gate's outcome; `status` is what
the handler returned — they differ when a handler fails after the gate
allowed the request. `operation` names the domain operation the request
routed to, and is what joins this line to the audit row that request wrote
(the audit ledger is a separate, never-purged store; see
[operations.md](./operations.md)).

## Correlation

One push reads end to end in three steps:

1. **Delivery**: every `/api` response echoes `X-Request-Id` (inbound value
   accepted if well-formed, UUID minted otherwise) and every line for that
   request carries it as `reqId`. Webhook lines additionally carry
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
`{prId, headSha}` → `generation.succeeded`. Correlated logs are the v1
trace; there is no tracing system (OTel is a deliberate non-goal for now).

## Health endpoints

Two bare, **unauthenticated** top-level paths on **each** of the API and the
web tier — outside `/api`, no session or token interaction, constant tiny
JSON either way:

- `GET /healthz` — liveness on both. Static 200 `{"ok":true}` with zero
  dependencies; stays up even while the database is unreachable.
- `GET /readyz` on the **API** — readiness. 200 when one `SELECT 1`
  round-trips to Postgres; 503 `{"ok":false}` otherwise.
- `GET /readyz` on the **web tier** — 200 when it reaches the API's own
  `/readyz` within 2s. A web tier that cannot reach the API is not ready,
  even when its own process is fine.

Wire **restart policies and the compose healthcheck to `/healthz` only** —
a database blip must flip you out of the load balancer (`/readyz`), never
restart-churn either tier. `/api/version` is unrelated: it is the CLI's
authenticated liveness probe, not orchestrator health. It also carries
`latest`, the newest release the update check has seen, with
`releaseNotesUrl`, `checkedAt`, `breaking` and `security`; with the check
off or not yet succeeded it carries `version` alone
([operations.md](./operations.md#the-update-check)). `dismissedVersion`,
when present, is the release the signed-in viewer dismissed the notice
for.

The **worker has no HTTP surface** by design (cohort norm): its liveness is
the process itself — compose runs it with `restart: on-failure`, so
transient crashes restart while a config error exits 0 and **stays down**:
look for `Exited (0)` in `docker compose ps` and the reason in
the last line of `docker compose logs worker`. The queue-level signal is
`job.retries.exhausted`.

## Log rotation

Compose ships `json-file` driver defaults on every service — `max-size:
10m`, `max-file: 3` (~30MB per service, bounded). If you ship logs off the
host (any recipe below), those defaults are still your local buffer; size
them to survive your shipper being down for as long as you care about.

## Recipe: Grafana + Loki

Promtail scrape (docker service discovery) — labels stay LOW-cardinality
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
# every first-class event, parsed
{service=~"web|worker"} | json | evt != ``

# the access log, slow requests only
{service="web"} | json | evt = `api.access` | durationMs > 1000

# one PR's whole worker-leg story (prId = the INTERNAL row id — see
# "Correlation" above for the one-line lookup; it is not the PR number)
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
      - alert: WebhookVerifyFailSustained
        # sustained rate, not raw hits — scanners will trip a >0 rule daily
        expr: sum(rate({service="web"} | json | evt = `webhook.verify.fail` [30m])) > 0.05
        labels: { severity: warning }
      - alert: AuditWriteFailed
        expr: sum(count_over_time({service="web"} | json | evt = `audit.fail` [15m])) > 0
        labels: { severity: critical }
      - alert: SpendCapSustained
        # only if you set a cap (spend.maxGenerationsPerDay) — an instance
        # pinned at it produces no briefs until 00:00 UTC
        expr: sum(count_over_time({service="worker"} | json | evt = `spend.cap.trip` [1h])) > 5
        labels: { severity: warning }
```

## Recipe: Datadog

Point the agent's docker log collection at the compose services; the JSON
lines auto-parse. Two settings matter: map `level` as the log status
remapper (string labels, not numbers), and facet `evt`. Monitors then key
off `@evt:job.retries.exhausted` (any occurrence),
`@evt:provider.error @status:(401 OR 403)` (any), and a rate-based monitor
on `@evt:webhook.verify.fail`.

## Recipe: CloudWatch

Use the `awslogs` driver (or FireLens) per service instead of `json-file`
(rotation becomes retention policy on the log group). Metric filters over
the JSON, e.g. `{ $.evt = "job.retries.exhausted" }`, feed alarms with
threshold ≥ 1; give `webhook.verify.fail` a rate-style alarm (e.g. ≥ 20 in
30 minutes) rather than ≥ 1.
