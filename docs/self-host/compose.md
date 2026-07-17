# Self-hosting with docker compose (BRIEF-3)

One command brings up the whole product: Postgres (the single stateful
dependency — ADR 0015), the web/API tier, and the background worker that
generates Briefs on every push.

```sh
cp .env.example .env      # fill in (see the env table below)
docker compose up -d
```

Then install your GitHub App on a repo (see [`github-app.md`](./github-app.md)),
point its webhook at your public URL, and open http://localhost:3000. From
here on, every push to an open PR gets its Brief generated automatically in
the background — push code, Brief appears, reviewer opens it.

## What runs

| service | what it does | port |
|---|---|---|
| `postgres` | store + job queue + locks, in one vanilla Postgres 17 | 127.0.0.1:5432 |
| `web` | TanStack Start SSR + the Hono API (webhooks, OAuth, reviewer reads) | 127.0.0.1:3000 |
| `worker` | long-lived graphile-worker runner draining `generate` jobs | — |

All published ports bind **loopback-only** — put a reverse proxy (or a
tunnel, for the dev loop) in front for anything internet-facing.

Migrations (app schema + graphile queue schema) run **idempotently at boot**
in both `web` and `worker` — whoever starts first applies them, the other
no-ops. There is no separate migrate step.

## Environment (`.env` at the repo root)

Compose loads `.env` into both services (`env_file`) and for `${...}`
interpolation. Leave a variable OUT entirely (don't set it empty) when it
doesn't apply — several loaders distinguish unset from empty.

| var | needed by | notes |
|---|---|---|
| `GITHUB_APP_ID` | web, worker | numeric App id |
| `GITHUB_APP_PRIVATE_KEY` / `..._PATH` | web, worker | exactly ONE of the two |
| `GITHUB_WEBHOOK_SECRET` | web | HMAC for inbound deliveries |
| `GITHUB_OAUTH_CLIENT_ID` / `_SECRET` | web | reviewer login |
| `SESSION_KEY_V1` | web | `openssl rand -base64 32` |
| `PUBLIC_BASE_URL` | web + worker | must match the App's OAuth callback origin; the worker builds the Entry comment's deep link from it |
| `ANTHROPIC_API_KEY` | worker + web | your model key (BYOK — your spend; the zero-config default) |
| `MERGEBRIEF_CONFIG` | worker + web | optional; path to `mergebrief.config.yaml` selecting another provider/model — see [generators.md](./generators.md) (its `generator.apiKeyEnv` names a different key var; CLI backends are local-only and not available to the deployed worker). The web/api side reads only its `drafts:` block (draft-PR policy, BRIEF-64) via a narrow loader — no provider keys needed there |
| `DATABASE_URL` | — | ignored in compose (overridden to the in-network DSN) |

## The lifecycle of a push

1. GitHub delivers `pull_request` → `web` verifies the HMAC, upserts the PR,
   and enqueues ONE debounced `generate` job (~60s trailing — rapid pushes
   coalesce).
2. `worker` picks the job up: fetches the PR via your App installation,
   generates the shared Brief (plus comparison marks / revision narrative
   against the previous briefed head, and pre-warmed re-review deltas per
   reviewer checkpoint), and stores them in Postgres.
3. A reviewer opens the PR in the web app; the artifacts are already there.

Push again mid-generation? The in-flight job notices within ~20s, **aborts
the model stream** (stopping token spend), records the run as `superseded`
(not a failure), and the newer push's job generates the new head.

## Verifying / troubleshooting

```sh
docker compose ps                     # web healthy, worker running
docker compose logs -f worker        # job pickup, generation progress
docker compose exec postgres psql -U code_review -d code_review \
  -c 'select kind, status, phase, error from generation order by updated_at desc limit 5;'
```

- `generation.status` walks `queued → running → succeeded` (or `superseded`
  after a superseding push; `failed` carries a sanitized reason).
- Misconfiguration surfaces differently per service: the **worker fails
  loudly at boot** (`docker compose logs worker` names the rejected env
  var), while the **web tier composes lazily on the first `/api`/`/auth`
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
handle these three — tracked as a board ticket, deliberate defaults until then:

1. **Postgres credentials** are the well-known dev pair
   (`code_review`/`code_review`), hardcoded in `docker-compose.yml`. Safe
   while 5432 binds loopback-only; change them (and the `DATABASE_URL`
   overrides) if you ever publish the port, share the host, or back the
   volume up off-machine.
2. **Host-header validation is pinned to `PUBLIC_BASE_URL`** for the web
   tier (`apps/web/vite.config.ts` derives the preview allow-list from it;
   localhost and IP literals stay allowed). Keep `PUBLIC_BASE_URL` accurate
   — a Host the instance doesn't recognize is 403'd. Still terminate TLS at
   your proxy; the app grants nothing based on Host either way (auth =
   webhook HMAC + `Secure` session cookies).
3. **A tunnel is production exposure.** While ngrok (or any tunnel) is up,
   the instance is internet-reachable: keep `GITHUB_WEBHOOK_SECRET` strong
   (it is the only gate on the webhook route), kill tunnels when not
   testing, and prefer a fixed domain + proxy over a long-lived tunnel.

## Dev loop against compose

The [ngrok webhook loop](../dev/webhook-loop.md) works unchanged with
compose: point the tunnel at `http://localhost:3000` and use the same dev
App. The only difference from the BRIEF-2 version of that doc: the queued
job no longer sits in the queue — the worker drains it and the artifacts
appear in Postgres.
