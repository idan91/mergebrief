# Self-hosting with docker compose

One command brings up the whole product: Postgres (the single stateful
dependency), the API, the web tier that proxies to it, and the background
worker that generates Briefs on every push.

```sh
cp .env.example .env      # fill in (see the env table below)
docker compose up -d
```

> **Set `POSTGRES_PASSWORD` in `.env` before the first `up`** if this
> instance will ever be reachable beyond your own machine. Postgres writes
> the role during its FIRST initialization only: after that the credential
> is baked into the `postgres_data` volume, and changing `.env` alone leaves
> the old password in place (the services then fail to connect). Fixing it
> later means an `ALTER ROLE` inside the container — or deleting the volume,
> which destroys every brief you have generated. The defaults
> (`code_review`/`code_review`) exist so `docker compose up` works with zero
> configuration on a loopback-only dev box; they are not a production
> credential.

Then install your GitHub App on a repo (see [`github-app.md`](./github-app.md)),
point its webhook at your public URL, and open http://localhost:3000. From
here on, every push to an open PR gets its Brief generated automatically in
the background — push code, Brief appears, reviewer opens it.

## What runs

| service | what it does | port |
|---|---|---|
| `postgres` | store + job queue + locks, in one vanilla Postgres 17 | 127.0.0.1:5432 |
| `api` | the Hono API (webhooks, OAuth, reviewer reads); holds the credentials and the database | in-network only |
| `web` | TanStack Start SSR; proxies `/api/*` to `api` and holds no credentials | 127.0.0.1:3000 |
| `worker` | long-lived graphile-worker runner draining `generate` jobs | — |

All published ports bind **loopback-only** — put a reverse proxy (or a
tunnel, for the dev loop) in front for anything internet-facing.

The `worker` restarts only on nonzero exits (`restart: on-failure`): a
config error logs its reason and exits 0, staying down instead of
restart-looping — see [generators.md](./generators.md)'s "When something
degrades" for the triage.

The `api` port is deliberately unpublished: it is reachable on the compose
network but from no published port, so nothing outside the project reaches it
without a route you add yourself. `web` reaches it through
`MERGEBRIEF_API_ORIGIN`, which compose sets to `http://api:3001`.

Migrations (app schema + graphile queue schema) run **idempotently at boot**
in both `api` and `worker` — whoever starts first applies them, the other
no-ops. There is no separate migrate step. (Exception: restricted database
roles can opt out with `MERGEBRIEF_AUTO_MIGRATE=false` — see the external
Postgres section below.)

## Environment (`.env` at the repo root)

Compose loads `.env` into `api` and `worker` (`env_file`) and uses it for
`${...}` interpolation everywhere. `web` gets no `env_file`: it is the
internet-facing tier, and the only two variables it reads are set on it
directly. Leave a variable OUT entirely (don't set it empty) when it
doesn't apply — several loaders distinguish unset from empty.

| var | needed by | notes |
|---|---|---|
| `GITHUB_APP_ID` | api, worker | numeric App id |
| `GITHUB_APP_PRIVATE_KEY` / `..._PATH` | api, worker | exactly ONE of the two |
| `GITHUB_WEBHOOK_SECRET` | api | HMAC for inbound deliveries |
| `GITHUB_OAUTH_CLIENT_ID` / `_SECRET` | api | reviewer login |
| `SESSION_KEY_V1` | api | `openssl rand -base64 32` |
| `PUBLIC_BASE_URL` | api + web + worker | must match the App's OAuth callback origin; the worker builds the Entry comment's deep link from it |
| `ANTHROPIC_API_KEY` | worker | your model key (BYOK — your spend; the zero-config default) |
| `MERGEBRIEF_CONFIG` | worker + api | optional; path to `mergebrief.config.yaml` selecting another provider/model — see [generators.md](./generators.md) (its `generator.apiKeyEnv` names a different key var; CLI backends are local-only and not available to the deployed worker). The API reads only its `drafts:` block (draft-PR policy) via a narrow loader — no provider keys needed there |
| `WORKER_CONCURRENCY` | worker | optional; generate jobs one worker process drains at once, default 1; each slot is a live provider child, see [generators.md](./generators.md) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | postgres | optional; default to `code_review` each. Compose DERIVES both services' in-network `DATABASE_URL` from them (with `sslmode=disable` pinned — the compose bridge is the private-network case, and `postgres` is a non-loopback hostname the TLS gate would otherwise refuse), so one edit moves every side. First-boot only (see the callout above); use the raw output of `openssl rand -hex 24` — the value lands in a connection string unescaped, and percent-encoding it breaks auth (see §1) |
| `DATABASE_URL` | — | ignored in the DEFAULT compose (overridden to the DSN derived from the `POSTGRES_*` values); the input for the external-database compose file. Non-loopback hosts must carry an explicit `sslmode` or boot is refused |
| `DATABASE_URL_FILE` | api, worker | optional; path to a file holding the DSN (compose `secrets:` mount). Wins over `DATABASE_URL` with a boot warning; surrounding whitespace trimmed |
| `MERGEBRIEF_AUTO_MIGRATE` | api, worker | optional, default `true`. `false` = check-only boot for DDL-less runtime roles: refuse with the pending count instead of applying migrations |
| `MERGEBRIEF_API_HOST` / `MERGEBRIEF_API_PORT` | api | optional; where the API listens. Compose sets `0.0.0.0:3001` so `web` can reach it; the default is loopback |
| `MERGEBRIEF_API_ORIGIN` | web | optional; where `/api/*` is proxied. Compose sets `http://api:3001`; the default is the API's loopback default |

## External Postgres (managed database)

The second supported deployment shape: web + worker from compose, the database from a managed provider (Neon, Supabase, RDS, ...)
or any Postgres you operate yourself.

```sh
# .env: DATABASE_URL=postgres://...?sslmode=verify-full&sslrootcert=...
docker compose -f docker-compose.external-db.yml up -d
```

`docker-compose.external-db.yml` is a separate checked-in file — web and
worker only, no `postgres` service, no `depends_on`. It reads
`DATABASE_URL` (and the other variables below) from `.env`, or from the
shell you run compose from (shell wins). The bundled `postgres` service and
its `POSTGRES_*` derivation do not apply here.

**Supported Postgres: 15 or newer.** The bundled `postgres:17-alpine` image
is the reference; anything a current managed provider offers is in range.
Older versions may work but are unsupported. One caveat on test coverage:
the automated suites run against PGlite (an embedded Postgres build), so
provider-specific behavior — TLS handshakes, pooled proxies, permission
models — is exactly what the suites cannot see; the smoke checklist below
is how a provider setup is actually proven.

### TLS: you must choose (`sslmode` in the DSN)

A `DATABASE_URL` whose host is not loopback **refuses boot unless the DSN
carries an explicit `sslmode`**. There is no separate TLS config — the DSN
is the whole decision:

| DSN parameter | meaning |
|---|---|
| `sslmode=verify-full&sslrootcert=/path/ca.pem` | TLS, certificate verified against that CA, hostname checked — **the recommended posture** |
| `sslmode=verify-full` | TLS, verified against Node's bundled trust roots (the Mozilla CA set — NOT the OS store, so mounting a CA into `/etc/ssl/certs` alone changes nothing; that mount only feeds `sslrootcert`) — works when the provider's chain ends in a publicly trusted CA. Check your provider: some (e.g. Supabase's dedicated-instance certificates) issue from a provider CA you must download and pin via `sslrootcert` |
| `sslmode=require` | see the trap below — write `verify-full` if you mean verification |
| `sslmode=disable` | plaintext — private networks / VPC peering only |

**The `sslmode=require` trap.** libpq (psql and most tooling) treats
`require` as "encrypt but do NOT verify the certificate". node-postgres
(the driver this product uses, pg 8.x) currently treats `require`,
`prefer`, and `verify-ca` as *aliases for `verify-full`* — it verifies,
and prints a security warning saying so. pg v9 will switch to the libpq
semantics, where `require` stops verifying. So: a DSN copied from a
provider dashboard with `sslmode=require` behaves differently here than in
psql, and will change behavior again on a future driver bump. Write
`verify-full` when you want verification (always, unless you know why not).

Providers whose CA is not in the system store (RDS is the common case)
need the CA bundle mounted into both containers — download the provider's
bundle (for RDS: the region bundle from AWS's docs), drop it at
`./secrets/provider-ca.pem`, and uncomment the CA mount lines in
`docker-compose.external-db.yml`, then reference it:

```
DATABASE_URL=postgres://app:...@db.xxx.rds.amazonaws.com:5432/mergebrief?sslmode=verify-full&sslrootcert=/etc/ssl/certs/provider-ca.pem
```

A missing/unreadable `sslrootcert` file refuses boot naming the path.

### The DSN as a secret file (`DATABASE_URL_FILE`)

An env var is visible in `docker inspect` and every env dump; a compose
`secrets:` mount is not. `DATABASE_URL_FILE` points at a file holding the
DSN (surrounding whitespace trimmed, so the usual trailing newline of a
secret file is harmless — the official postgres image convention):

1. put the DSN in `./secrets/database-url` (the `secrets/` directory is
   gitignored),
2. uncomment the `secrets:` blocks in `docker-compose.external-db.yml`
   (top-level and per-service),
3. set `DATABASE_URL_FILE=/run/secrets/database-url` in `.env` instead of
   `DATABASE_URL`.

If both variables are set, the file wins and boot logs a warning naming
the shadowed `DATABASE_URL`.

### Restricted database roles (`MERGEBRIEF_AUTO_MIGRATE=false`)

By default both services apply migrations at boot, which needs DDL. If
your runtime role is read/write-only (least-privilege posture), set
`MERGEBRIEF_AUTO_MIGRATE=false`: boot then only *checks* — read-only —
that the database matches the checked-in migrations, and refuses with the
pending count when it is behind. The apply workflow moves to you; see
[operations.md](./operations.md#external-database-auto-migratefalse).

### Deployment shapes: what is supported

Supported: (1) the all-in-one compose, (2) compose + external Postgres —
this section. Beyond that: every service is env-configured and stateless
outside Postgres, so splitting them across machines (or into
another orchestrator) works in principle — it is untested and unsupported;
you are off the map, though probably not far off. Kubernetes/Helm
packaging is out of scope until real demand shows up.

## The lifecycle of a push

1. GitHub delivers `pull_request` → `web` proxies it to `api`, which verifies
   the HMAC over the exact bytes GitHub signed, upserts the PR, and enqueues
   ONE debounced `generate` job (~60s trailing — rapid pushes coalesce).
2. `worker` picks the job up: fetches the PR via your App installation,
   generates the shared Brief (plus comparison marks / revision narrative
   against the previous briefed head, and pre-warmed re-review deltas per
   reviewer checkpoint), and stores them in Postgres.
3. A reviewer opens the PR in the web app; the artifacts are already there.

Push again mid-generation? The in-flight job notices within ~20s, **aborts
the model stream** (stopping token spend), records the run as `superseded`
(not a failure), and the newer push's job generates the new head.

## Verifying / troubleshooting

Both HTTP services probe `GET /healthz` (static liveness — deliberately not
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
  -c "select kind, status, phase, error from generation order by updated_at desc limit 5;"'
```

- `generation.status` walks `pending → running → succeeded` (or `superseded`
  after a superseding push; `failed` carries a sanitized reason; `capped`
  means the instance hit its daily generation cap and the run was skipped — see
  [generators.md](./generators.md#daily-generation-cap)).
- Misconfiguration surfaces differently per service: the **worker fails
  loudly at boot** (`docker compose logs worker` names the rejected env
  var), while the **web tier composes lazily on the first `/api`
  request** — it boots and reports healthy on bad env, then 503s the first
  webhook delivery or login with the config error in `docker compose logs
  web`. After `up`, hit `curl -i localhost:3000/api/repos/0/pulls/0/brief`
  once: a 401 means the web env parsed; a 503 means check the logs.
- The worker retries transient failures with backoff (graphile-owned);
  permanent conditions (e.g. GitHub's "diff too large" 406) are recorded as
  `failed` without retry.

## Hardening before real exposure

The compose defaults are tuned for a loopback-only, single-operator machine.
Before pointing a domain (or leaving a tunnel up long-term) at an instance,
work through this section.

### 1. Postgres credentials

Set `POSTGRES_PASSWORD` (and optionally `POSTGRES_USER`/`POSTGRES_DB`) in
`.env` **before the first boot** — see the callout at the top of this page
for why "before" is critical. Both services' `DATABASE_URL` derives from
these values automatically.

```sh
openssl rand -hex 24        # use the output verbatim
```

Hex, verbatim, is the recommendation for a reason: the value is written to
the Postgres role EXACTLY as you give it, and is separately interpolated
into a connection string that gets percent-DECODED when parsed. So a
password containing `@ : / ? #` — or a percent-encoded one — authenticates
as a different string than the role was created with, and both services
fail to connect on first boot. That is the unrecoverable path (the role
already exists in the volume), so do not hand-craft the value.

Leave 5432 bound to loopback unless you have a concrete reason to publish
it; nothing in the product needs the port from outside the compose network.

### 2. Terminate TLS at a reverse proxy

Nothing in the stack speaks TLS. Put a proxy in front and let it own the
certificate; `web` keeps listening on `127.0.0.1:3000`. Caddy is the
smallest complete example — a two-line `Caddyfile` gets you automatic
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
as the GitHub App's OAuth callback origin and webhook URL.

Two things follow from terminating TLS elsewhere:

- **Session cookies are `Secure`.** Reviewer login works over `https://` (or
  `http://localhost` during development) and silently will not persist over
  plain `http://` on a real hostname.
- **Host-header validation is pinned to `PUBLIC_BASE_URL`**
  (`apps/web/vite.config.ts` derives the allow-list from it; localhost and
  IP literals stay allowed). A Host the instance doesn't recognize is 403'd,
  so keep the value accurate — including the scheme and any non-default
  port. The app grants nothing based on Host either way; this is
  defense-in-depth, not the auth boundary.

Any proxy works — nginx, Traefik, a cloud load balancer. Forward the
original Host, and don't strip `X-Request-Id` if you correlate logs
([observability.md](./observability.md)).

### 3. The webhook secret is the ONLY gate on the webhook route

`POST /api/webhooks/github` is unauthenticated by design: GitHub cannot
present a session or a token. Every delivery is accepted or rejected purely
on the HMAC-SHA256 signature computed with `GITHUB_WEBHOOK_SECRET`
(constant-time compared; failures log `evt: webhook.verify.fail`). There is
no IP allow-list, no second factor, and no rate limit in front of it (only a
1 MB body cap).

So the secret IS the perimeter for that route:

- Generate it, never invent it: `openssl rand -hex 32`. A guessable secret
  lets anyone on the internet enqueue generation jobs against your provider
  key — this is the one setting where weakness costs money.
- Use a DIFFERENT secret per instance (dev, staging, production), and rotate
  by changing it in GitHub's App settings and `.env` together, then
  restarting `web`. Deliveries signed with the old secret start failing
  immediately — a sustained `webhook.verify.fail` rate after a rotation
  means one side didn't move.
- Never put it in the config YAML or a command line; `.env` (or your secret
  store) only.

### 4. A tunnel is production exposure

While ngrok (or any tunnel) is up, the instance is internet-reachable with
whatever secrets it currently has. Kill tunnels when not testing, and prefer
a fixed domain plus the proxy above over a long-lived tunnel.

Day-two operations — upgrading, what migrations do at boot, and Postgres
backup/restore — live in [`operations.md`](./operations.md).

## Dev loop against compose

The [ngrok webhook loop](../dev/webhook-loop.md) works unchanged with
compose: point the tunnel at `http://localhost:3000` and use the same dev
App. One difference: the queued job no longer sits in the queue — the
worker drains it and the artifacts appear in Postgres.
