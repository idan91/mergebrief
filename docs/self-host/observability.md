# Logs, alerts and tracing

Every MergeBrief process writes structured JSON to stdout, one line per event. There are no log files, no telemetry back to anyone, and no `/metrics` endpoint: you ship the log lines to your own stack, alert on a small set of named events, and count from the logs whatever you want to graph. Product terms such as held push and Entry comment are defined in the [glossary](../glossary.md). Traces are optional and off until you point the processes at an OTLP endpoint.

## Quick start

1. **Ship the logs.** Pick the recipe for your stack under [Wire your stack](#wire-your-stack). Each one reads the compose services' stdout and keeps `service` as the only label.
2. **Alert on these five events.** Every line that matters carries an `evt` name, a stable contract ([Event vocabulary](#event-vocabulary)):

   | Alert on | Rule | What it means |
   | --- | --- | --- |
   | `job.retries.exhausted` | Any occurrence | A push's brief gave up for good. This is the worker alert. |
   | `provider.error` with `kind` `auth` or `provider-spend-limit` | Any occurrence | The model provider refused the key, or its account hit a spend limit. No brief generates until you fix it. |
   | `webhook.dispatch.fail` | Any occurrence | A correctly signed GitHub delivery failed to save or queue. |
   | `token.decrypt.fail` | Any occurrence | The session key cannot open stored GitHub tokens ([what fails](./secrets.md#if-the-session-key-changed-or-was-lost)). |
   | `webhook.verify.fail` | A sustained rate, never a single hit | After a secret rotation, one side kept the old webhook secret. Single hits are internet scanners. |

3. **Check** that lines arrive and parse:

   ```sh
   docker compose logs --no-log-prefix --tail 1 api | jq '{level, evt, msg}'
   ```

   It prints one parsed line, such as an `api.access` request line. Then search your log backend for `evt="api.access"` and confirm the same lines are there.

The [event vocabulary](#event-vocabulary) marks a few more events worth an alert once these are in place, such as `audit.fail` and `db.version.ahead`.

## Wire your stack

### Grafana and Loki

Grafana ended support for Promtail on March 2, 2026; this recipe uses Grafana Alloy, its replacement. An existing Promtail config converts with `alloy convert --source-format=promtail`.

Run Alloy beside the stack with read access to the Docker socket:

```yaml
# docker-compose.override.yml
services:
  alloy:
    image: grafana/alloy:<version>   # pin a release from github.com/grafana/alloy/releases
    command: ["run", "--storage.path=/var/lib/alloy/data", "/etc/alloy/config.alloy"]
    volumes:
      - ./config.alloy:/etc/alloy/config.alloy:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

```alloy
// config.alloy
discovery.docker "containers" {
  host = "unix:///var/run/docker.sock"
}

discovery.relabel "compose_service" {
  targets = []

  rule {
    source_labels = ["__meta_docker_container_label_com_docker_compose_service"]
    target_label  = "service"
  }
}

loki.source.docker "containers" {
  host          = "unix:///var/run/docker.sock"
  targets       = discovery.docker.containers.targets
  relabel_rules = discovery.relabel.compose_service.rules
  forward_to    = [loki.write.default.receiver]
}

loki.write "default" {
  endpoint {
    url = "http://loki:3100/loki/api/v1/push"
  }
}
```

`http://loki:3100` resolves only when Loki runs on the same compose network as Alloy, for example as another service in `docker-compose.override.yml`. For a Loki elsewhere, put its own address in `url`. Keep `service` as the only label: everything else is read from the JSON at query time. **Check:** in Grafana, `{service="api"}` returns lines.

Useful LogQL:

```logql
# every first-class event, parsed (api and worker write them; web writes none)
{service=~"api|worker"} | json | evt != ``

# slow requests
{service="api"} | json | evt = `api.access` | durationMs > 1000

# one push's worker story, by its internal pull request row id (see Follow one push)
{service="worker"} | json | prId = `<internal-pr-row-id>`
```

Alert rules for the five events:

```yaml
groups:
  - name: mergebrief
    rules:
      - alert: WorkerRetriesExhausted
        expr: sum(count_over_time({service="worker"} | json | evt = `job.retries.exhausted` [15m])) > 0
        labels: { severity: critical }
      - alert: ProviderAuthBroken
        expr: sum(count_over_time({service="worker"} | json | evt = `provider.error` | kind = `auth` [15m])) > 0
        labels: { severity: critical }
      - alert: ProviderSpendLimitReached
        expr: sum(count_over_time({service="worker"} | json | evt = `provider.error` | kind = `provider-spend-limit` [15m])) > 0
        labels: { severity: critical }
      - alert: WebhookDispatchFailed
        expr: sum(count_over_time({service="api"} | json | evt = `webhook.dispatch.fail` [15m])) > 0
        labels: { severity: critical }
      - alert: SessionKeyMismatch
        expr: sum(count_over_time({service="api"} | json | evt = `token.decrypt.fail` [15m])) > 0
        labels: { severity: critical }
      - alert: WebhookVerifyFailSustained
        # a sustained rate, not raw hits: scanners trip a > 0 rule daily
        expr: sum(rate({service="api"} | json | evt = `webhook.verify.fail` [30m])) > 0.05
        labels: { severity: warning }
```

### Datadog

Point the Agent's Docker log collection at the compose services; the JSON lines parse on their own. Two settings matter: map `level` with the log status remapper (the values are strings, not numbers), and add a facet on `evt`. Then create monitors on:

- `@evt:job.retries.exhausted`, any occurrence
- `@evt:provider.error @kind:auth`, any occurrence
- `@evt:provider.error @kind:provider-spend-limit`, any occurrence
- `@evt:webhook.dispatch.fail`, any occurrence
- `@evt:token.decrypt.fail`, any occurrence
- `@evt:webhook.verify.fail`, a rate-based monitor

To send traces to the same Agent, run it beside the stack and point every process at its OTLP receiver. The Agent holds the API key, so no MergeBrief process needs OTLP headers:

```yaml
# docker-compose.override.yml
services:
  datadog-agent:
    image: gcr.io/datadoghq/agent:7
    # Its own file, not .env: api and worker load .env, and the key is the Agent's alone.
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

Run `docker compose up -d`. `HOST_PROC: /proc` is not optional: without it the Agent's OTLP pipeline fails at start with "process does not exist" and port 4318 never opens. Datadog's log pipeline detects the `trace_id` and `span_id` attributes on the JSON lines without a remapper.

### CloudWatch

Use the `awslogs` driver (or FireLens) per service instead of `json-file`; rotation becomes the log group's retention policy. Create a metric filter per alert, such as `{ $.evt = "job.retries.exhausted" }`, and alarm on a sum of at least 1. Give `webhook.verify.fail` a rate-style alarm instead, such as at least 20 in 30 minutes.

### Any OTLP backend for traces

For Grafana Cloud, Honeycomb, a self-hosted Tempo or Jaeger, or anything else that accepts OTLP, run an OpenTelemetry Collector beside the stack and let it hold the backend's credentials:

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

Run `docker compose up -d` to start the collector and recreate the services. Logs keep their own path (one of the recipes above); every line written inside a trace carries `trace_id` and `span_id` for the backend to join on.

## Count things from the logs

There is no `/metrics` endpoint to scrape. The numbers worth graphing are already fields on log lines, so derive them in your log backend. In LogQL:

```logql
# briefs finished per hour
sum(count_over_time({service="worker"} | json | evt = `generation.succeeded` [1h]))

# pushes held by trigger conditions per hour
sum(count_over_time({service="worker"} | json | evt = `generation.hold` [1h]))

# model-call time, p95 over an hour, per kind (brief, delta, revision-narrative)
quantile_over_time(0.95, {service="worker"} | json | evt = `generation.complete` | unwrap durationMs [1h]) by (kind)

# queue wait before a run starts, p95 over an hour
quantile_over_time(0.95, {service="worker"} | json | evt = `generation.start` | unwrap waitMs [1h])

# API requests per status
sum by (status) (count_over_time({service="api"} | json | evt = `api.access` [5m]))

# every named event, per name
sum by (evt) (count_over_time({service=~"api|worker"} | json | evt != `` [1h]))
```

In Datadog, generate a metric from logs on the same queries (count of `@evt:generation.succeeded`, a distribution of `@durationMs` for `@evt:generation.complete`). In CloudWatch, a metric filter takes a value from the line, such as `$.durationMs` for `{ $.evt = "generation.complete" }`.

Today's started runs against the daily cap come from the API, not the logs: `mergebrief spend`, for an operator ([spend-cap.md](./spend-cap.md#see-todays-count)).

## Health checks

`api` and `web` each answer two paths outside `/api`, with no session or token and a tiny constant JSON body:

| Path | On `api` | On `web` |
| --- | --- | --- |
| `GET /healthz` | Always 200 `{"ok":true}`, even while the database is down | Always 200 `{"ok":true}`, even while the api is down |
| `GET /readyz` | 200 when one `SELECT 1` reaches Postgres, else 503 `{"ok":false}` | 200 when the api's own `/readyz` answers within 2 seconds, else 503 |

- **Restart policies and container health checks use `/healthz` only.** A database blip should take the instance out of the load balancer through `/readyz`, never restart it.
- **The worker has no HTTP surface.** Compose restarts it after a crash (`restart: on-failure`), while a configuration error exits 0 and stays down. Watch for `Exited (0)` in `docker compose ps -a`; the last line of `docker compose logs worker` names the reason ([A service exits with code 0](./troubleshooting.md#a-service-exits-with-code-0)). The queue-level signal is `job.retries.exhausted`.
- **`/api/version` is not a health check.** It needs a session or token, and it is how the CLI checks it can sign in. It also carries `latest`, the newest release the update check has seen ([Turn off or mirror the update check](./upgrade.md#turn-off-or-mirror-the-update-check)).

**Check** from the host:

```sh
curl -s http://localhost:3000/healthz
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/readyz
```

The first prints `{"ok":true}`; the second prints `200`.

## Follow one push

To trace one push from GitHub's delivery to its brief:

1. **Find the delivery.** Every request the web tier receives gets a fresh `X-Request-Id`, which every line for that request carries as `reqId`, in web and api alike. Webhook lines also carry `deliveryId`, GitHub's `X-GitHub-Delivery`, the id the App's **Advanced → Recent Deliveries** page shows.
2. **Find the enqueue.** When the delivery queues work, the api writes one `generation.enqueue` line with `deliveryId`, `reqId`, `repoId`, `prNumber`, `prId` and `headSha`. A delivery that queues nothing (a close, a stale redelivery, a head a stored brief already covers) writes none. To get a pull request's `prId`, filter `generation.enqueue` by `prNumber`:

   ```logql
   {service="api"} | json | evt = `generation.enqueue` | prNumber = `<pr-number>`
   ```

3. **Follow the worker.** Every worker line for the job carries the same `prId` and `headSha`, ending at `generation.succeeded` with the stored `briefId`. Filter by that pair, never by a delivery: pushes coalesce into one pending job per pull request, so several deliveries can share one job, and a later `generation.enqueue` for the same `prId` replaces the pending job.

`prId` is the instance's internal pull request row id, not the GitHub pull request number. The same id (as `pull_request_id`) and `headSha` sit on the queue row and the `generation` rows, so you can join a log line to the database directly.

With [tracing](#tracing) on, the same story is two linked traces: the delivery's, and the job's, which links back to it.

## Read a failed generation's raw output

When a model's answer fails the brief's schema, or is cut off at its output limit, the worker saves it as `<label>-<time>-<n>.failed.json` in `/app/apps/worker/out` inside the worker container, readable by the worker's user only. It is text about the pull request's code, with credential-shaped strings redacted. Copy the folder out to read it; with more than one worker, add `--index 2` and so on for each:

```sh
docker compose cp worker:/app/apps/worker/out ./worker-failures
ls ./worker-failures
```

The folder is not a volume, so recreating the container empties it. Each worker deletes its own files once they are seven days old, when it starts and once a day. No setting changes that window.

## Tracing

Tracing is off by default. Set an OTLP/HTTP endpoint in `.env`, and the api, the worker and the web tier each send OpenTelemetry traces to it:

```sh
# .env
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

Run `docker compose up -d` ([Apply a change](./configuration.md#apply-a-change)). **Check:** each process logs `tracing on` at boot. With no endpoint set, a process loads no OpenTelemetry SDK at all.

Every `OTEL_*` variable MergeBrief reads, with its default and what a bad value does, is in [configuration.md](./configuration.md#logging-and-tracing). Two choices matter here:

- **Leave `OTEL_SERVICE_NAME` unset.** The processes name themselves `mergebrief-web`, `mergebrief-api` and `mergebrief-worker`.
- **Keep vendor keys in a collector.** Compose never passes the OTLP headers to the web tier, so point it at a collector or agent you run beside the stack, as the recipes above do, and let that hold the key.

What each trace covers and what it never records is under [What a trace holds](#what-a-trace-holds).

### Try tracing locally with Jaeger

`docker-compose.tracing.yml` runs a throwaway Jaeger for trying tracing before you pick a backend: the trace viewer on `127.0.0.1:16686` and an OTLP/HTTP receiver on `4318`, with traces kept in memory, so a restart clears them. It sits in the repository, not among a release's files, so fetch it at the tag of the release you run (`1.4.0` is `v1.4.0`):

```sh
curl -fsSLo docker-compose.tracing.yml https://raw.githubusercontent.com/idan91/mergebrief/v1.4.0/docker-compose.tracing.yml
```

Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318` in `.env`, then start the stack with the file merged in. Naming files with `-f` turns off the automatic load of `docker-compose.override.yml`, so add `-f docker-compose.override.yml` when you have one:

```sh
docker compose -f docker-compose.yml -f docker-compose.tracing.yml up -d --wait
```

**Check:** open `http://127.0.0.1:16686`, push to a pull request, and find the `mergebrief-api` and `mergebrief-worker` services in the search form. On a remote server, reach the viewer through an SSH tunnel: `ssh -L 16686:127.0.0.1:16686 <user>@<host>`.

To stop it, remove the endpoint from `.env` and run `docker compose up -d --remove-orphans`.

## Reference

### The log line

```json
{"level":"info","time":1784667468255,"pid":42,"hostname":"3f9c2a1b7d4e","reqId":"7f0b…","evt":"api.access","method":"GET","path":"/api/inbox","status":200,"durationMs":12,"decision":"200","msg":"request"}
```

- **`level`** is a string: `error`, `warn`, `info` or `debug`. `LOG_LEVEL` sets the threshold, `info` by default ([configuration.md](./configuration.md#logging-and-tracing)).
- **`msg`** is a human-readable message. Alert on `evt` and `level`, never on `msg` text.
- **`evt`** is present only on the first-class events below. Everything else (boot and shutdown, queue lifecycle, progress lines) is plain leveled logging.
- **`trace_id` and `span_id`** appear only while tracing is on and the line is written inside a span: the 32- and 16-hex ids, under the OTel log data model's names.
- **Secrets never appear.** Sensitive fields are removed at the logger, not masked: a redacted key is simply absent. Inside `msg` or a serialized `err` or `error` field, three things are masked in place, each with a marker you can search for:
  - a URL-shaped substring becomes `[redacted-url]` (`file://` stack frames are kept);
  - a credential-shaped token, or the value after `password=`, becomes `[redacted-token]`;
  - the values a failed database query bound are cut and the statement stays; a message that only quotes one shows `[redacted-params]`.
- **A failed job's line** carries the first line of its error message and of each cause under it, so a failed query reads as its statement and then the database's reason.
- **Format.** Lines are JSON everywhere except `NODE_ENV=development`, which renders with pino-pretty. The image does not ship pino-pretty, so never set `NODE_ENV=development` on it: the logger cannot start. To read a production log pretty, pipe it through the `pino-pretty` CLI.

### Event vocabulary

These `evt` names are a stable contract: a rename, removal or field change gets a breaking-change entry in [api-changelog.md](../api-changelog.md), and an addition is not breaking.

| `evt` | Level | Process | Key fields | Alert | What it means |
| --- | --- | --- | --- | --- | --- |
| `webhook.verify.fail` | warn | api | `deliveryId`, `reqId` | Sustained rate | A delivery's signature did not match. Raw hits are scanner noise; a sustained rate after a secret rotation means the two sides hold different secrets. |
| `webhook.dispatch.fail` | error | api | `deliveryId`, `reqId`, `err` | Yes | A signed delivery failed to save or queue. |
| `webhook.delivery.duplicate` | debug | api | `deliveryId`, `reqId` | No | A pull request, review, check run or status delivery whose signature was already processed in the last 72 hours was skipped. A manual redelivery of a successful delivery lands here. |
| `job.fail` | error | worker | `prId`, `headSha`, `permanent`, `attempt`, `maxAttempts` | Yes | One attempt of a job failed. |
| `job.retries.exhausted` | error | worker | `prId`, `headSha`, `attempt`, `maxAttempts` | Yes, the worker alert | The queue gave up on the job, or the push spent its claims and its brief ends `failed` as `attempts-exhausted`. From a `sync-entry` job it means the Entry comment may not match the brief's state. |
| `provider.error` | error | worker | `provider`, `kind`, job bindings | `auth` and `provider-spend-limit`: yes. Sustained `provider-transient` or `timeout`: degraded | One attempt's call to the model provider failed; `kind` says how ([below](#provider-error-kinds)). |
| `token.refresh.fail` with `kind` | error | api | `reqId`, `reviewerId`, `kind` | Yes | A session or API token could not rotate its GitHub credentials, for a reason the operator fixes; the session is kept and the request answers 500. `kind` is GitHub's OAuth error token, or `expiration-not-enabled`, when GitHub refused the App's own credentials or settings: fix the App. `kind: seal-failed`: GitHub rotated but the session key could not seal the new pair ([GitHub token refresh fails](./troubleshooting.md#github-token-refresh-fails)). |
| `token.refresh.fail` without `kind` | error | api | `reqId`, `reviewerId` | Sustained rate | Not an App fault. GitHub refused that user's refresh token, so the grant is retired: its sessions end, its API tokens are revoked, and that user signs in again. Also logged when an API token expired or was revoked while its request refreshed. |
| `token.decrypt.fail` | error | api | `reqId`, `reviewerId` | Yes | The session key cannot open a stored GitHub token ([what fails and how to recover](./secrets.md#if-the-session-key-changed-or-was-lost)). |
| `token.refresh.unavailable` | warn | api | `reqId`, `reviewerId`, `refreshTokenPossiblyConsumed` | Sustained rate | GitHub did not answer a token rotation within 10 seconds or answered with an outage, or another refresh held the same grant for over 2 seconds. Sessions and tokens are kept and the request answers 502. `refreshTokenPossiblyConsumed: true` means GitHub may have rotated before the call failed, so a later `token.refresh.fail` for the same reviewer can trace back to it ([GitHub token refresh fails](./troubleshooting.md#github-token-refresh-fails)). |
| `authorization.revoked` | info | api | `deliveryId`, `reqId`, `reviewerId`, `sessions`, `tokens`, `grants` | No | A user revoked the App on github.com, and every session, API token and grant they held here was deleted. |
| `grant.revoke.fail` | warn | api, worker | `reqId` (api only), `grantId`, `code` | Sustained rate | GitHub refused or did not answer a token revoke, so that GitHub token may stay valid until it expires. The revoke follows a sign-out, an API token revoke, the hourly sweep, or a token rotation that found the account no longer allowed on the instance and retired its grant. `code` is `token-delete-failed` (422, 5xx or no answer), or `credential-unreadable` when the session key cannot open the stored token or the worker runs without `SESSION_KEY_V1`. A 404 is not logged: GitHub answers it for a token it already invalidated and for a wrong client secret, so a drifted secret shows as `token.refresh.fail` instead. |
| `url-fallback-token.owner.fail` | error | api, worker | `status`, `code` | Yes | GitHub refused `MERGEBRIEF_URL_FALLBACK_TOKEN` at boot (401, a 403 that is not a rate limit, or 404), so it serves nobody until it is replaced and the process restarts. |
| `audit.fail` | error | api | `reqId`, `operation`, `err` | Yes | The action completed but its audit row was not written ([An audit row is missing](./troubleshooting.md#an-audit-row-is-missing)). |
| `spend.cap.trip` | warn | worker | `repo`, `prId`, `headSha`, `cap`, `dayUtc`, plus `needed` and `left` for a large run | Sustained rate | The daily cap is working as configured, but an instance stuck at it produces no briefs until 00:00 UTC. |
| `generation.enqueue` | info | api | `deliveryId`, `reqId`, `repoId`, `prNumber`, `prId`, `headSha` | No | A delivery added or replaced the pull request's job. The line that joins a delivery to the worker's `prId` and `headSha`. |
| `generation.start` | info | worker | `prId`, `headSha`, `waitMs`, `attempt` | No | A run started; `waitMs` is how long it queued. |
| `generation.complete` | info | worker | `kind`, `outcome`, `durationMs` | No | One model call finished; nothing else records how long a generation took. `outcome` is `succeeded`, `failed`, or `skipped` for a delta call cut at its output cap that stored a skip record. |
| `generation.succeeded` | info | worker | `prId`, `headSha`, `prNumber`, `briefId` | No | The run finished; `briefId` is the brief it stored. |
| `generation.hold` | info | worker | `prId`, `headSha`, `kinds` | No | A trigger condition held the push before any claim; `kinds` lists the unmet condition kinds. It spends nothing and generates once its conditions pass, or on a Generate click. |
| `artifact.check.fail` | warn | worker | `kind`, `issueCount`, `firstPath`, job bindings | Sustained rate | A generated brief, delta brief or revision narrative failed its stored-shape check and was written anyway. `kind` takes the same values as on `generation.complete`; no body content rides the line ([A brief failed its write check](./troubleshooting.md#a-brief-failed-its-write-check)). |
| `generator.tool-access` | warn | worker | `provider` | No | Once at boot when the generator is `codex` or `cursor`, naming what that CLI can still reach ([generators.md](./generators.md#what-stays-open)). |
| `generator.plain-http` | warn | worker | `host` | No | Once at boot when `generator.baseUrl` is plain `http://` to a host other than the worker's own, so the API key and the code travel unencrypted. |
| `link-fetch.public` | warn | worker | none | No | Once at boot while `linkFetch.mode` is `public`, the default: the worker fetches any public link a description holds. `off` or `allowlist` silences it. |
| `jira.token.check` | warn; error when `outcome: refused` | worker | `outcome`, `site` | `refused`: yes | At most once at boot, when a `jira` context source is configured. `refused`: Atlassian refused the email and API token, so every Jira read reports `no-credential` until both are right and the worker restarts. `broader`: the token can do more than read issues; replace it with one scoped to `read:jira-work` only. No line does not prove the token is scoped right ([Jira refused the token at boot](./troubleshooting.md#jira-refused-the-token-at-boot)). |
| `update.available` | info; warn when `security` | api | `current`, `latest`, `breaking`, `security`, `releaseNotesUrl` | When `security` is true | Once when `latest` is first newer than the running version, and once at boot while behind. |
| `update.check.fail` | info on the first failure after boot, debug after | api | `err` | No | The network blocks github.com or the release file is malformed; `/api/version` carries no fresh `checkedAt`. |
| `db.version.upgrade` | info | api, worker | `from`, `to` | No | The one-row `instance_version` table moved forward at boot. |
| `db.version.ahead` | warn | api, worker | `db`, `running` | Yes | An older process booted under a database a newer one last recorded: a rollback. It keeps running. |
| `api.access` | info; debug for a 2xx `GET /api/version` | api | `method`, `path`, `status`, `durationMs`, `decision`, `operation`, `repoId`, `reviewerId`, `reqId` | No | The access log: one line per request, numeric ids only, never a token or cookie. |

On `api.access`, `decision` is the auth gate's outcome and `status` is what the handler returned; they differ when a handler fails after the gate allowed the request. `operation` names the product operation the request reached, and joins the line to the audit row that request wrote. The browser polls `GET /api/version` once a minute per visible tab, which is why its 2xx lines are `debug`.

### Provider error kinds

`provider.error` carries `kind`, never the HTTP status: key alerts on `kind`. A push that retries logs one line per failed attempt. What the brief page then shows for each is in [A brief failed](./troubleshooting.md#a-brief-failed).

| `kind` | What failed |
| --- | --- |
| `auth` | The provider refused the key (401 or 403). |
| `provider-spend-limit` | The provider account reached a spend limit. |
| `config` | The provider refused the request or the model (400 or 404), or answered with a redirect, which is never followed. |
| `cli-missing` | A CLI provider's command is not installed in the worker. |
| `provider-transient` | A 408, 429 or 5xx, or a failed connection, after the provider SDK's own retries. |
| `timeout` | The call ran past its time limit. |
| `schema-floor` | The answer failed the brief's schema after salvage and one feedback retry. |
| `refusal` | The model declined to answer. |
| `output-cut` | The answer reached its output token cap. |
| `opaque` | Anything the adapter could not classify. |

### What a trace holds

- **One trace per web request.** It starts at the web tier, continuing a `traceparent` your reverse proxy sends, and follows the proxied call and every page render's reads into the api, down to each Postgres query.
- **One trace per job.** A worker job opens its own trace (`process generate`, `process recover-generation`, `process generate-large`, `process recover-generation-large`, `process sync-entry`, the scheduled sweeps and `process reconcile-webhook-deliveries`) with the job's queries and its calls to GitHub and the model provider. It links to the trace that queued it: a delivery, a request such as a regenerate, or the job that re-queued it. Scheduled tasks start unlinked. It is a link, not a parent, because a later push replaces a queued job and one job may serve several deliveries.
- **Not traced:** `/healthz`, `/readyz`, the web tier's static assets, and background calls outside any request or job.
- **Redacted:** URL query strings (the sign-in callback carries its code there), and the user agent and client address the HTTP instrumentation reads from headers.
- **Never recorded:** any request header but the host, cookies, SQL parameter values, and the text of a job's error. A failed query's span keeps Postgres's error message, which can quote a value.

The web tier decides its own sampling: it continues a caller's trace id but ignores the caller's sampled flag. Under a ratio sampler that trace id still steers the decision, so a client can push its own requests in or out of the sample; that costs you volume, never data.

Named spans mark the business steps, so a trace reads as the flow and a monitor can key on a step. The names below are stable: a rename is a breaking change, the same as an `evt` name. Their attributes are ids, counts and decision tokens, never content.

| Span | Process | What it covers | Attributes |
| --- | --- | --- | --- |
| `<METHOD> <route>` | api | The request, named by its matched route, such as `POST /api/webhooks/github` | `http.route` |
| `<METHOD> /api/*`, `<METHOD> /*` | web | A proxied call, a page render | `http.route` |
| `<operation id>` | api | One product operation, such as `read-brief` or `submit-review`, with its gate and handler | `mergebrief.operation` |
| `webhook.verify` | api | The delivery's signature check | `mergebrief.verified` |
| `webhook.dispatch` | api | The event's writes | `mergebrief.webhook.kind`, `mergebrief.webhook.action` |
| `generation.trigger` | api | The ingest transaction and its enqueue | `mergebrief.applied`, `mergebrief.queued`, `mergebrief.covered_by_brief`, `mergebrief.pr_id` |
| `authz.session` | api | The cookie or token lookup | `mergebrief.credential` |
| `authz.repo` | api | The repository access check | `mergebrief.cache_hit` |
| `authz.installation` | api | Which installation holds the repository | |
| `pr.load` | api | The pull request row an operation reads | `mergebrief.found` |
| `github.publish_review`, `github.publish_comment` | api | A review or comment written to GitHub | `mergebrief.drafts` |
| `generation.open` | worker | The run's guards and first GitHub read | `mergebrief.opened` |
| `generation.decide` | worker | The run's decision | `mergebrief.decision` |
| `generation.claim` | worker | The daily-cap claim | `mergebrief.claim` |
| `generation.inputs` | worker | The files, diff and config | |
| `brief.generate` | worker | The brief | |
| `entry.ready` | worker | The ready Entry comment | |
| `generation.revision` | worker | Revision marks and narrative | |
| `generation.deltas` | worker | The checkpoint deltas | `mergebrief.deltas_written` |
| `generation.finish` | worker | The settled row | |
| `chat <model>` | worker | One generation, its provider retries summed | `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `mergebrief.generation.kind`, `mergebrief.generation.effort`, `mergebrief.provider_requests` |
| `<store>.<method>` | api, worker | One persistence call, such as `briefs.listForPullRequest`; its queries nest under it | |

A `<store>.<method>` span is named for the method a caller reached and changes when that method is renamed, so it is outside the stable contract: key a monitor on a business-step name instead.

Token counts come from the provider's own accounting; codex reports none, and a CLI provider reports one total per run. With tracing on, an OpenAI-compatible provider is asked to include usage in its stream, and asked again without it if it rejects the option.

### Log rotation

Compose sets the `json-file` driver on every service with `max-size: 10m` and `max-file: 3`, about 30 MB per service. If you ship logs off the host, that is still your local buffer: size it to cover your shipper being down for as long as you care about.
