# Self-hosting with docker compose

One command brings up the whole product: Postgres (the single stateful
dependency), the API, the web tier that proxies to it, and the background
worker that generates Briefs as pull requests are pushed.

```sh
mkdir mergebrief && cd mergebrief
curl -fsSLo docker-compose.yml https://github.com/Idan91/mergebrief/releases/download/v1.6.0/docker-compose.yml
curl -fsSLo .env.example https://github.com/Idan91/mergebrief/releases/download/v1.6.0/.env.example
cp .env.example .env      # fill in (see the env table below)
docker compose up -d --wait
```

Replace `v1.6.0` with the release you want; the
[releases page](https://github.com/Idan91/mergebrief/releases) lists them.

> **Set `POSTGRES_PASSWORD` in `.env` before the first `up`** if this
> instance will ever be reachable beyond your own machine. Postgres writes
> the role during its FIRST initialization only: after that the credential
> is baked into the `postgres_data` volume, and changing `.env` alone leaves
> the old password in place (the services then fail to connect). Fixing it
> later means an `ALTER ROLE` inside the container, or deleting the volume,
> which destroys every brief you have generated. The defaults
> (`code_review`/`code_review`) exist so `docker compose up` works with zero
> configuration on a loopback-only dev box; they are not a production
> credential.

Then install your GitHub App on a repo (see [`github-app.md`](./github-app.md)),
point its webhook at your public URL, and open http://localhost:3000. From
here on, the pushes to an open PR get their Brief generated in the
background, debounced and under the instance's daily cap: push code, Brief
appears, reviewer opens it. A PR whose
author the repository does not trust waits for one Generate click from a
collaborator with push access first
([who triggers a brief](./github-app.md#who-triggers-a-brief)).

## What the host holds

One folder, no checkout of the repository and no build:

- **`docker-compose.yml`**, a GitHub Release asset. It pins that release's
  exact image tag, and an upgrade replaces it byte for byte, so never edit
  it.
- **`.env`**, your settings, started from the same release's `.env.example`
  asset.
- **`docker-compose.override.yml`**, optional, for your own edits: ports,
  volumes, resource limits, a mount for `mergebrief.config.yaml`, an
  external database. Compose merges it into `docker-compose.yml` on its
  own (on an external database, through `COMPOSE_FILE`: see below), and an
  upgrade never touches it.

Tracing is off until `.env` names an OTLP endpoint; a collector or the
Datadog Agent goes in the override file
([observability.md](./observability.md#tracing)).

**One image, three commands.** `api`, `web` and `worker` all run
`ghcr.io/idan91/mergebrief:X.Y.Z`, each started with its own command. The
image is built for `linux/amd64` and `linux/arm64`, and Docker pulls the one
that matches the host. Postgres runs the official `postgres:17-alpine`
image, never bundled into ours.

**Exact pin, never `latest`.** The shipped compose file names one release,
`ghcr.io/idan91/mergebrief:1.6.0`, and that pin is what makes the
[upgrade](./operations.md#the-upgrade-step) and the
[rollback](./operations.md#rolling-back) a matter of swapping one file. The
registry also publishes a `latest` tag that moves to every release, majors
included. Do not point the compose file at it: the next pull would upgrade
the instance without the backup or the steps a breaking release needs, and
the file would no longer say which release you run.

**Building from source is the developer path.** From a checkout of this
repository, `git pull && docker compose build && docker compose up -d`
builds the images from the working tree. That is for working on MergeBrief,
not for upgrading an instance: a source build reports its version as
`dev`, so it never checks for releases and never shows the version notice.

## What runs

| service | what it does | port |
|---|---|---|
| `postgres` | store + job queue + locks, in one vanilla Postgres 17 | 127.0.0.1:5432 |
| `api` | the Hono API (webhooks, OAuth, reviewer reads); holds the credentials and the database | in-network only |
| `web` | TanStack Start SSR; proxies `/api/*` to `api` and holds no credentials | 127.0.0.1:3000 |
| `worker` | long-lived graphile-worker runner draining `generate` jobs | none |

All published ports bind **loopback-only**. Put a reverse proxy (or a
tunnel, for the dev loop) in front for anything internet-facing.

The `worker` restarts only on nonzero exits (`restart: on-failure`): a
config error logs its reason and exits 0, staying down instead of
restart-looping; see [generators.md](./generators.md)'s "When something
degrades" for the triage.

The `api` port is deliberately unpublished: it is reachable on the compose
network but from no published port, so nothing outside the project reaches it
without a route you add yourself. `web` reaches it through
`MERGEBRIEF_API_ORIGIN`, which compose sets to `http://api:3001`. That
name covers every api replica, so one `web` can front several apis
([Running more than one api](./operations.md#running-more-than-one-api)).

Migrations (app schema + graphile queue schema) run **idempotently at boot**
in both `api` and `worker`: whoever starts first applies them, the other
no-ops. There is no separate migrate step. (Exception: restricted database
roles can opt out with `MERGEBRIEF_AUTO_MIGRATE=false`; see the external
Postgres section below.)

## Environment (`.env` beside `docker-compose.yml`)

Compose loads `.env` into `api` and `worker` (`env_file`) and uses it for
`${...}` interpolation everywhere. `web` gets no `env_file`: it is the
internet-facing tier and holds no credentials, so compose sets what it reads
on it directly: `PUBLIC_BASE_URL`, `MERGEBRIEF_API_ORIGIN` and six tracing
variables, the two OTLP endpoints, `OTEL_RESOURCE_ATTRIBUTES`, the sampler
pair and `OTEL_SDK_DISABLED`. Every other `OTEL_*` variable in `.env`,
`OTEL_TRACES_EXPORTER` included, reaches `api` and `worker` only. Leave a variable OUT entirely (don't set it empty) when it
doesn't apply: several loaders distinguish unset from empty.
[configuration.md](./configuration.md) lists every variable each process
reads, with what an empty value does.

| var | needed by | notes |
|---|---|---|
| `GITHUB_APP_ID` | api, worker | numeric App id |
| `GITHUB_APP_PRIVATE_KEY` / `..._PATH` | api, worker | exactly ONE of the two |
| `GITHUB_WEBHOOK_SECRET` | api, worker | HMAC for inbound deliveries, which only `api` receives; the worker parses the same GitHub config. `openssl rand -hex 32`; under 32 characters refuses boot |
| `GITHUB_OAUTH_CLIENT_ID` / `_SECRET` | api, worker | reviewer login; the worker uses them to revoke a dead grant's token at GitHub after its hourly sweep, and refuses boot without them |
| `GITHUB_APP_SLUG` | api, worker | optional; the App's URL name, the last segment of `https://github.com/apps/<slug>`. Set, Home links a viewer with no reachable installation to its install page; unset, that line carries no link |
| `MERGEBRIEF_URL_FALLBACK_TOKEN` | api, worker | optional; a GitHub token (fine-grained, Contents and Pull requests read) that reads a pasted private PR the App is not installed on, tried only after the reviewer's own token is denied. It serves only the GitHub account that owns it, so make it on your own account. `MERGEBRIEF_URL_BOX_TOKEN` and `MERGEBRIEF_URL_BOX_TOKEN_REVIEWERS` are no longer read: set, each logs one warning and is ignored |
| `SESSION_KEY_V1` | api, worker | `openssl rand -base64 32`; the worker opens grants with it for pasted PRs and for the hourly sweep's GitHub revokes. Both services read the same `.env` |
| `SESSION_KEY_REF` | api | optional; the env var name new GitHub tokens are sealed under, default `SESSION_KEY_V1`. A value that is not an env var name refuses boot. See [Tokens at rest](./operations.md#tokens-at-rest) for rotation |
| `PUBLIC_BASE_URL` | api + web + worker | must match the App's OAuth callback origin; the worker builds the Entry comment's deep link from it. An absolute http(s) URL with no credentials in it, or api and worker refuse boot |
| `MERGEBRIEF_WEB_HOST` / `_PORT` | web | optional; where the web process listens, default `0.0.0.0` and `3000`. The web service reads no `.env`, so set them under its `environment:`, and move its port mapping and healthcheck with the port |
| `SERVER_VERSION` | api, worker | set by the image; unset or empty means `dev`. An override must be printable ASCII without spaces, or api and worker refuse boot |
| `ANTHROPIC_API_KEY` | worker | your model key (BYOK: your spend; the zero-config default) |
| `MERGEBRIEF_CONFIG` | worker + api | optional; path to `mergebrief.config.yaml` selecting another provider/model; see [generators.md](./generators.md) (its `generator.apiKeyEnv` names a different key var; CLI backends are local-only and not available to the deployed worker). The API reads only its `drafts:`, `spend:` and `operators:` blocks through a narrow loader, so it needs no provider keys. The image carries no config file: mount it into `api` and `worker` from `docker-compose.override.yml` ([generators.md](./generators.md#the-config-file)) |
| `WORKER_CONCURRENCY` | worker | optional; generate jobs one worker process drains at once, default 1. What a slot costs depends on the provider class, see [generators.md](./generators.md#worker-slots) |
| `WORKER_LARGE_CONCURRENCY` | worker | optional; slots of the large pool, which runs the multi-call briefs, default 1. See [generators.md](./generators.md#the-large-pool) |
| `REVISION_NARRATIVE_ENABLED` | worker | optional, default `true`; `false` skips the revision narrative. A token other than `true`/`false`/`1`/`0`/`yes`/`no`/`on`/`off` refuses boot |
| `HUGE_SPAN_RATIO` | worker | optional, default `0.65`; the share of a PR's changed lines at which an incremental span falls back to the full brief. Above 0 and at most 1, or boot is refused |
| `WORKER_COUNT` | compose | optional; worker containers compose starts, default 1. Concurrent generations = `WORKER_COUNT` x (`WORKER_CONCURRENCY` + `WORKER_LARGE_CONCURRENCY`); `docker compose up --scale worker=N` wins for that run |
| `API_COUNT` | compose | optional; api containers compose starts, default 1. Every replica serves every request, with the caveats in [operations.md](./operations.md#running-more-than-one-api); `docker compose up --scale api=N` wins for that run |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | postgres | optional; default to `code_review` each. Compose DERIVES both services' in-network `DATABASE_URL` from them (with `sslmode=disable` pinned: the compose bridge is the private-network case, and `postgres` is a non-loopback hostname the TLS gate would otherwise refuse), so one edit moves every side. First-boot only (see the callout above); use the raw output of `openssl rand -hex 24`, since the value lands in a connection string unescaped, and percent-encoding it breaks auth (see §1) |
| `DATABASE_URL` | none | ignored in the DEFAULT compose (overridden to the DSN derived from the `POSTGRES_*` values); the input when the database is external ([below](#external-postgres-managed-database)). Non-loopback hosts must carry `sslmode=verify-full` or `sslmode=disable` or boot is refused ([TLS](#tls-verify-full-or-disable-sslmode-in-the-dsn)) |
| `DATABASE_URL_FILE` | api, worker | optional; path to a file holding the DSN (compose `secrets:` mount). Wins over `DATABASE_URL` with a boot warning; surrounding whitespace trimmed |
| `MERGEBRIEF_AUTO_MIGRATE` | api, worker | optional, default `true`; empty reads as `false`. `false` = check-only boot for DDL-less runtime roles: refuse with the pending count instead of applying migrations |
| `DATABASE_POOL_MAX` | api, worker | optional, default `10` (empty included); the size of each Postgres pool. An api process opens one pool and a worker two at this size (its store and its job queue) plus the large pool's job queue at `WORKER_LARGE_CONCURRENCY` + 2. A request waits up to 10 seconds for a free connection, then fails. api replicas x this value + worker count x (2 x this value + `WORKER_LARGE_CONCURRENCY` + 2) must stay under Postgres `max_connections` ([operations.md](./operations.md#running-more-than-one-api)). A whole number of at least 2 (the job queue keeps one connection for its listener and needs another to work), or api and worker refuse boot |
| `MERGEBRIEF_API_HOST` / `MERGEBRIEF_API_PORT` | api | optional; where the API listens. Compose sets `0.0.0.0:3001` so `web` can reach it; the default is loopback |
| `MERGEBRIEF_API_ORIGIN` | web | optional; where `/api/*` is proxied. Compose sets `http://api:3001`; the default is the API's loopback default |
| `MERGEBRIEF_UPDATE_CHECK` | api | optional, default `true` (empty included); the hourly fetch of the release file that drives the version notice ([operations.md](./operations.md#the-update-check)). `false` turns it off; a token other than `true`/`false`/`1`/`0`/`yes`/`no`/`on`/`off` refuses boot |
| `MERGEBRIEF_UPDATE_CHECK_URL` | api | optional; a mirror of `version.json` for a network that blocks github.com. An absolute http(s) URL with no credentials in it, or api refuses boot |
| `MERGEBRIEF_ATTACHMENT_QUOTA_FILES` / `MERGEBRIEF_ATTACHMENT_QUOTA_MB` / `MERGEBRIEF_ATTACHMENT_QUOTA_WINDOW_MINUTES` | api | optional, defaults `10` / `30` / `10` (empty included); what one reviewer may attach per window, per api replica ([attachments.md](./attachments.md#upload-quota)). Positive whole numbers, and the megabytes at least `10`, the size limit of one file; anything else refuses boot |
| `MERGEBRIEF_MEDIA_MAX_MB` | api | optional, default `100` (empty included); the largest video or image, in megabytes, the API streams, judged on the file's full size ([attachments.md](./attachments.md)). A positive whole number, or api refuses boot |

### Who owns which setting

Capacity and secrets are env; policy and provider are yaml; nothing lives
in both.

| setting | owner | precedence |
|---|---|---|
| slots per worker (`WORKER_CONCURRENCY`) | `.env` | env only |
| large-pool slots per worker (`WORKER_LARGE_CONCURRENCY`) | `.env` | env only |
| worker count (`WORKER_COUNT`) | `.env` | `docker compose up --scale worker=N` wins for that run |
| api count (`API_COUNT`) | `.env` | `docker compose up --scale api=N` wins for that run |
| daily generation cap (`spend.maxGenerationsPerDay`) | `mergebrief.config.yaml` | yaml only; no env and no `.mergebrief/` override |
| provider, model, effort (`generator.*`) | `mergebrief.config.yaml` | yaml only; the key VALUE comes from the env var the yaml names |
| credentials, DSN, public origin | `.env` | `DATABASE_URL_FILE` wins over `DATABASE_URL` |
| `MERGEBRIEF_CONFIG` (the yaml's own path) | `.env` | unset = zero-config defaults |

## External Postgres (managed database)

The second supported deployment shape: `api`, `web` and `worker` from
compose, the database from a managed provider (Neon, Supabase, RDS, ...)
or any Postgres you operate yourself.

A second shipped file, `docker-compose.external-db.yml`, carries the same
three services without the bundled `postgres`. It is a separate file on
purpose: an override cannot remove a service, and `depends_on` cannot name
a profiled-out one. Fetch it from the release beside the default file and
name it in `.env`, so every plain `docker compose` command in these pages
reads it:

```sh
# .env: DATABASE_URL=postgres://...?sslmode=verify-full&sslrootcert=...
# .env: COMPOSE_FILE=docker-compose.external-db.yml
docker compose up -d --wait
```

Setting `COMPOSE_FILE` turns off the automatic load of
`docker-compose.override.yml`, and every file it lists must exist or each
compose command fails before anything starts. Your own edits still live in
the override file, which an upgrade never touches: once you create it,
append it to the list, `COMPOSE_FILE=docker-compose.external-db.yml:docker-compose.override.yml`.

`api` and `worker` then read `DATABASE_URL` (and the other variables below)
from `.env`. The bundled `postgres` service and its `POSTGRES_*` derivation
do not apply here, and neither does the `docker compose exec postgres`
backup in [operations.md](./operations.md#backup): your provider's snapshot
replaces it.

**Supported Postgres: 16 or newer.** The bundled `postgres:17-alpine` image
is the reference; anything a current managed provider offers is in range.
Older versions may work but are unsupported. One caveat on test coverage:
the automated suites run against PGlite (an embedded Postgres build), so
provider-specific behavior (TLS handshakes, pooled proxies, permission
models) is exactly what the suites cannot see; the smoke checklist below
is how a provider setup is actually proven.

### TLS: verify-full or disable (`sslmode` in the DSN)

A `DATABASE_URL` whose host is not loopback **boots only on
`sslmode=verify-full` or `sslmode=disable`**. There is no separate TLS
config: the DSN is the whole decision:

| DSN parameter | meaning |
|---|---|
| `sslmode=verify-full&sslrootcert=/path/ca.pem` | TLS, certificate verified against that CA, hostname checked: **the recommended posture** |
| `sslmode=verify-full` | TLS, verified against Node's bundled trust roots (the Mozilla CA set, NOT the OS store, so mounting a CA into `/etc/ssl/certs` alone changes nothing; that mount only feeds `sslrootcert`). Works when the provider's chain ends in a publicly trusted CA. Check your provider: some (e.g. Supabase's dedicated-instance certificates) issue from a provider CA you must download and pin via `sslrootcert` |
| `sslmode=disable` | plaintext, for private networks / VPC peering only |

**Refused:** `require`, `prefer`, `verify-ca`, `no-verify`, any other
value, and `uselibpqcompat=true` beside anything but `verify-full`. libpq
(psql and most tooling) treats `require` as "encrypt but do NOT verify
the certificate". node-postgres (pg 8.x) verifies on `require`, `prefer`
and `verify-ca` today, but its warning steers to `uselibpqcompat=true`,
which switches to the libpq meaning, and pg v9 makes that the default.
`no-verify` never verifies. A DSN copied from a provider dashboard with
`sslmode=require` refuses boot: change it to `verify-full`.

Providers whose CA is not in the system store (RDS is the common case)
need the CA bundle mounted into `api` and `worker`. Download the
provider's bundle (for RDS: the region bundle from AWS's docs), drop it at
`./secrets/provider-ca.pem`, mount it in `docker-compose.override.yml` (the
`volumes:` entries in the example under the next heading), then reference
it:

```
DATABASE_URL=postgres://app:...@db.xxx.rds.amazonaws.com:5432/mergebrief?sslmode=verify-full&sslrootcert=/etc/ssl/certs/provider-ca.pem
```

A missing/unreadable `sslrootcert` file refuses boot naming the path.

### The DSN as a secret file (`DATABASE_URL_FILE`)

An env var is visible in `docker inspect` and every env dump; a compose
`secrets:` mount is not. `DATABASE_URL_FILE` points at a file holding the
DSN (surrounding whitespace trimmed, so the usual trailing newline of a
secret file is harmless, per the official postgres image convention):

1. put the DSN in `./secrets/database-url`, and keep the `secrets/` folder
   out of anything you commit or share,
2. declare the secret in `docker-compose.override.yml` and hand it to `api`
   and `worker`,
3. set `DATABASE_URL_FILE=/run/secrets/database-url` in `.env` instead of
   `DATABASE_URL`.

```yaml
# docker-compose.override.yml
services:
  api:
    secrets:
      - database-url
    volumes:
      - ./secrets/provider-ca.pem:/etc/ssl/certs/provider-ca.pem:ro
  worker:
    secrets:
      - database-url
    volumes:
      - ./secrets/provider-ca.pem:/etc/ssl/certs/provider-ca.pem:ro
secrets:
  database-url:
    file: ./secrets/database-url
```

Drop the `volumes:` entries when the provider's CA is publicly trusted.

If both variables are set, the file wins and boot logs a warning naming
the shadowed `DATABASE_URL`.

### Restricted database roles (`MERGEBRIEF_AUTO_MIGRATE=false`)

By default both services apply migrations at boot, which needs DDL. If
your runtime role is read/write-only (least-privilege posture), set
`MERGEBRIEF_AUTO_MIGRATE=false`: boot then only *checks*, read-only, that
the database matches the release's migrations, and exits 1 naming the
pending count when it is behind. The apply step moves to you and runs as
`docker compose run --rm api migrate` with a DDL-capable DSN; see
[operations.md](./operations.md#external-database-auto-migratefalse).

## Other platforms

Compose is the one supported way to run MergeBrief: the all-in-one compose
above, or compose with an external Postgres. Every service is
env-configured and stateless outside Postgres, so the same image runs under
another orchestrator (Kubernetes, Nomad, ECS) in principle, but that is
untested and unsupported, and no recipe for one ships yet.

If you run it elsewhere anyway, the image tag is the knob. Start
`ghcr.io/idan91/mergebrief:X.Y.Z` as the three services the shipped
`docker-compose.yml` defines, with the commands and environment it gives
them, and pin the exact tag. An upgrade changes that tag everywhere it
appears; a rollback is the previous task definition. A rolling deploy,
where old and new containers serve side by side, must take
[one release at a time](./operations.md#what-happens-to-the-schema).

## The lifecycle of a push

1. GitHub delivers `pull_request` → `web` proxies it to `api`, which verifies
   the HMAC over the exact bytes GitHub signed, upserts the PR, and enqueues
   ONE debounced `generate` job. The first push fixes when the job runs,
   about 60s later; a push inside that window only moves the job to the
   newer head, so rapid pushes coalesce into one run.
2. `worker` picks the job up: fetches the PR via your App installation,
   generates the shared Brief (plus comparison marks / revision narrative
   against the previous briefed head, and pre-warmed re-review deltas per
   reviewer checkpoint), and stores them in Postgres.
3. A reviewer opens the PR in the web app; the artifacts are already there.

Push again mid-generation? The in-flight job notices within ~20s, **aborts
the model stream** (stopping token spend), records the run as `superseded`
(not a failure), and the newer push's job generates the new head. A brief
generated in parts (a PR past the single-call size) stops aborting once its
detail calls start: the parts already paid for are kept, the run finishes on
its own head, and the newer push's job runs after it.

## Verifying / troubleshooting

Both HTTP services probe `GET /healthz` (static liveness, deliberately not
`/readyz`, so a database blip degrades reads instead of restart-churning the
tier). The two `/readyz` endpoints differ: `api`'s is one `SELECT 1`, and
`web`'s is `api`'s answer, so an unreachable API and an unreachable database
are one answer from the outside. Logs are structured JSON on stdout with `json-file` rotation
defaults (`10m` × 3 per service); the event vocabulary, correlation ids,
health-endpoint semantics, and Grafana/Datadog/CloudWatch recipes live in
[`observability.md`](./observability.md).

```sh
docker compose ps                     # api + web healthy, worker running
docker compose logs -f worker        # job pickup, generation progress
docker compose exec postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "select kind, status, phase, error_code from generation order by updated_at desc limit 5;"'
```

- `generation.status` walks `pending → running → succeeded` (or `superseded`
  after a superseding push; `failed` carries a sanitized reason; `capped`
  means the instance hit its daily generation cap and the run was skipped; see
  [generators.md](./generators.md#daily-generation-cap)).
- Misconfiguration fails loudly at boot in the **api** and the **worker**
  alike (`docker compose logs api` or `logs worker` names the rejected env
  var); the web tier holds no credentials and only proxies `/api/*`. After
  `up`, hit `curl -i localhost:3000/api/version` once: a 401 means both
  tiers are up and the api parsed its env; a 503 means the api is down,
  check its logs.
- The worker retries transient failures with backoff (graphile-owned);
  permanent conditions (e.g. GitHub's "diff too large" 406) are recorded as
  `failed` without retry.
- `up` fails with a Dockerfile-not-found error: the image pull was denied
  or the registry was unreachable, and Compose fell through to building
  from source, which a release folder cannot do. The fix is the pull
  (`docker compose pull`, then read its error), never a checkout.

## Hardening before real exposure

The compose defaults are tuned for a loopback-only, single-operator machine.
Before pointing a domain (or leaving a tunnel up long-term) at an instance,
work through this section.

If `MERGEBRIEF_URL_FALLBACK_TOKEN` is set, it serves only the GitHub account that
owns it: at boot the api and worker ask GitHub whose token it is, and every
other reviewer gets the instance as if no token were set. A PAT made on a bot
or machine account therefore serves no person; make it on your own account.
If GitHub refuses the token (revoked, expired, or not a user token), it
serves nobody and the `url-fallback-token.owner.fail` line names the fix: replace
the token and restart. If GitHub cannot answer, the token serves nobody until
a background retry succeeds. Once a brief is open on the token, diff and file
reads are limited to the commits MergeBrief recorded for that pull request.
The file path is not limited: any file at one of those commits is readable.

### 1. Postgres credentials

Set `POSTGRES_PASSWORD` (and optionally `POSTGRES_USER`/`POSTGRES_DB`) in
`.env` **before the first boot**. See the callout at the top of this page
for why "before" is critical. Both services' `DATABASE_URL` derives from
these values automatically.

```sh
openssl rand -hex 24        # use the output verbatim
```

Hex, verbatim, is the recommendation for a reason: the value is written to
the Postgres role EXACTLY as you give it, and is separately interpolated
into a connection string that gets percent-DECODED when parsed. So a
password containing `@ : / ? #`, or a percent-encoded one, authenticates
as a different string than the role was created with, and both services
fail to connect on first boot. That is the unrecoverable path (the role
already exists in the volume), so do not hand-craft the value.

Leave 5432 bound to loopback unless you have a concrete reason to publish
it; nothing in the product needs the port from outside the compose network.

### 2. Terminate TLS at a reverse proxy

Nothing in the stack speaks TLS. Put a proxy in front and let it own the
certificate; `web` keeps listening on `127.0.0.1:3000`. Caddy is the
smallest complete example: a two-line `Caddyfile` gets you automatic
Let's Encrypt certificates and renewal:

```caddyfile
brief.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

```sh
sudo caddy run --config ./Caddyfile     # or: caddy start / systemd unit
```

Then set `PUBLIC_BASE_URL=https://brief.example.com` in `.env` and restart
both services (`docker compose up -d`). It must match the value you register
as the GitHub App's OAuth callback origin and webhook URL. It is also the
one origin a signed-in browser may send state-changing requests from: a
POST that arrives with another `Origin` is refused with a 403, so the value
has to be the origin reviewers actually browse, scheme and port included.

Two things follow from terminating TLS elsewhere:

- **Session cookies are `__Host-` prefixed and `Secure`.** The prefix makes
  the browser refuse the cookie without `Secure`, with a `Domain` attribute,
  or off `Path=/`, so a sibling subdomain on the same apex cannot shadow it.
  Reviewer login works over `https://` (or `http://localhost` during
  development) and silently will not persist over plain `http://` on a real
  hostname.
- **Host-header validation is pinned to `PUBLIC_BASE_URL`'s hostname.**
  The web server allows that hostname, `localhost` and `*.localhost`, and
  bare IP addresses, and answers any other Host with a 403. Only the
  hostname is compared: the scheme and port play no part in this check
  (the `Origin` check above is the one that compares them). The app grants
  nothing based on Host either way; this is defense-in-depth, not the auth
  boundary.

Any proxy works: nginx, Traefik, a cloud load balancer. Forward the
original Host, and don't strip `X-Request-Id` if you correlate logs
([observability.md](./observability.md)).

### 3. The webhook secret is the ONLY gate on the webhook route

`POST /api/webhooks/github` is unauthenticated by design: GitHub cannot
present a session or a token. Every delivery is accepted or rejected purely
on the HMAC-SHA256 signature computed with `GITHUB_WEBHOOK_SECRET`
(constant-time compared; failures log `evt: webhook.verify.fail`). There is
no IP allow-list and no second factor. The app ships no rate limit either,
only a 1 MB body cap: put one in your proxy
([below](#rate-limit-the-webhook-route-at-your-proxy)).

So the secret IS the perimeter for that route:

- Generate it, never invent it: `openssl rand -hex 32`. `api` and `worker`
  refuse to boot on a secret under 32 characters, counted after trimming
  whitespace. A guessable secret lets anyone on the internet enqueue
  generation jobs against your provider key. This is the one setting where
  weakness costs money.
- Use a DIFFERENT secret per instance (dev, staging, production), and rotate
  by changing it in GitHub's App settings and `.env` together, then running
  `docker compose up -d`, which recreates `api` with the new value (`api`
  verifies deliveries; `web` never sees the secret, and
  `docker compose restart` keeps the old environment). Deliveries signed with the old secret start failing
  immediately; a sustained `webhook.verify.fail` rate after a rotation
  means one side didn't move.
- Never put it in the config YAML or a command line; `.env` (or your secret
  store) only.

#### Rate-limit the webhook route at your proxy

The signature check is what keeps forged deliveries out; a proxy limit only
sheds a flood of them before it reaches `api`. Scope the limit to the
webhook path and size it for GitHub's bursts: closing or labelling many
pull requests at once sends one delivery per pull request, and they all
arrive from a small pool of GitHub addresses, so a per-address limit sees
them as one caller. GitHub never retries a failed delivery on its own, so
a delivery the limit refuses is lost until you redeliver it from the App's
**Advanced** tab.

nginx ships the limiter (`ngx_http_limit_req_module`):

```nginx
# in the http {} block
limit_req_zone $binary_remote_addr zone=github_webhook:10m rate=10r/s;

server {
    # ...listen, TLS, and your `location /` proxying to 127.0.0.1:3000...

    location = /api/webhooks/github {
        limit_req zone=github_webhook burst=100 nodelay;
        limit_req_status 429;
        proxy_set_header Host $host;
        proxy_pass http://127.0.0.1:3000;
    }
}
```

`burst=100 nodelay` lets a burst of 100 through at once and refills at
10 a second; without `limit_req_status`, nginx refuses with a 503. If nginx
sits behind another load balancer, key the zone on the real client address
(`set_real_ip_from` and `real_ip_header`), or every caller shares one bucket.

Core Caddy has no rate limiter. The third-party
[`caddy-ratelimit`](https://github.com/mholt/caddy-ratelimit) module adds
one, built into a custom binary with `xcaddy`:

```sh
xcaddy build --with github.com/mholt/caddy-ratelimit
```

```caddyfile
brief.example.com {
    rate_limit {
        zone github_webhook {
            match {
                path /api/webhooks/github
            }
            key    {remote_host}
            events 600
            window 1m
        }
    }
    reverse_proxy 127.0.0.1:3000
}
```

A refused request gets a 429 with `Retry-After`. Behind another load
balancer, key on `{client_ip}` with Caddy's `trusted_proxies` set instead of
`{remote_host}`.

### 4. A tunnel is production exposure

While ngrok (or any tunnel) is up, the instance is internet-reachable with
whatever secrets it currently has. Kill tunnels when not testing, and prefer
a fixed domain plus the proxy above over a long-lived tunnel.

Day-two operations (upgrading, what migrations do at boot, and Postgres
backup/restore) live in [`operations.md`](./operations.md).

## Dev loop against compose

The [ngrok webhook loop](../dev/webhook-loop.md) works unchanged with
compose: point the tunnel at `http://localhost:3000` and use the same dev
App. One difference: the queued job no longer sits in the queue: the
worker drains it and the artifacts appear in Postgres.
