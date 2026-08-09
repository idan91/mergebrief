# Local webhook loop

How to run the webhook receiver end-to-end on your machine and watch a real GitHub
`pull_request` event turn into a `pull_request` row + a queued `generate` job. This is also
the **fixture-capture** step: the real payloads you replay here are the ones PR A re-verifies
its parser against, so grab a few while you have the tunnel open.

> Prereq: a **dev** GitHub App registered and installed on a test repo — see
> [`../self-host/github-app.md`](../self-host/github-app.md). Use the App's dev credentials
> here; never paste production secrets into a local `.env`.

## 1. Start Postgres

```sh
docker compose up -d postgres
```

This brings up the loopback-only Postgres from `docker-compose.yml`
(`postgres://code_review:code_review@127.0.0.1:5432/code_review`).

## 2. Configure `apps/web/.env`

Copy `apps/web/.env.example` to `apps/web/.env` and fill in the dev-App values. **Placeholders
below — never commit real values.** Idan's live dev credentials live in 1Password, not here.

```sh
# Database (matches docker-compose.yml)
DATABASE_URL=postgres://code_review:code_review@127.0.0.1:5432/code_review

# GitHub App (dev registration)
GITHUB_APP_ID=123456
# Exactly ONE of the next two — the inline PEM, or a path to the .pem file:
GITHUB_APP_PRIVATE_KEY_PATH=./secrets/dev-app.private-key.pem
# GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=replace-with-openssl-rand-hex-32
GITHUB_OAUTH_CLIENT_ID=Iv1.replace-me
GITHUB_OAUTH_CLIENT_SECRET=replace-me
```

The startup wiring (`apps/web/src/server/webhookApp.ts`) reads these once on the first
webhook request: it parses both configs, opens the DB, and installs the `graphile_worker`
schema. A missing/invalid var makes the first request **fail loudly** rather than serve a
broken webhook — so if the endpoint 500s on the first delivery, check the server log for the
config-error message.

## 3. Run the app

```sh
pnpm dev            # web app on http://localhost:3000
```

The webhook route is mounted on the web origin at `POST /api/webhooks/github` (via the custom
TanStack Start server entry, `apps/web/src/server.ts`). No separate API process.

## 4. Open a public tunnel

```sh
ngrok http 3000
```

GitHub rejects `localhost`, so it must reach you through a public URL. ngrok (not
`gh webhook forward`) is the recommended tunnel because the app also needs the OAuth callback
publicly reachable — one tunnel serves both. See the rationale in
[`../self-host/github-app.md`](../self-host/github-app.md#webhook).

Set the dev App's **Webhook URL** to:

```
https://<your-ngrok-subdomain>.ngrok-free.app/api/webhooks/github
```

(Free ngrok URLs change on restart — expect to re-paste. The **Webhook secret** in the App
settings must equal `GITHUB_WEBHOOK_SECRET`, or every delivery fails the HMAC check with 401.)

## 5. Fire an event

Open, push to, reopen, or mark-ready a PR on the installed repo. GitHub sends a
`pull_request` delivery; the handler verifies the HMAC over the raw body, upserts the PR, and
enqueues one debounced `generate` job — all fast, before returning 200.

## 6. Verify the write path

```sh
docker compose exec postgres psql -U code_review -d code_review \
  -c 'select repo_slug, pr_number, state from pull_request order by updated_at desc limit 5;' \
  -c 'select task_identifier, key, payload from graphile_worker.jobs order by created_at desc limit 5;'
```

Expect a `pull_request` row for your PR and a `graphile_worker.jobs` row with
`task_identifier = generate` and `key = generate:<pull_request_id>`.

The queue also **drains**: run the worker (`pnpm -C packages/worker start`
with the same env, or the compose `worker` service — see
[`../self-host/compose.md`](../self-host/compose.md)) and the job disappears after the
debounce, the `generation` row walks `queued → running → succeeded`, and the Brief lands in
the `brief` table. Without a worker running, the row sits in the queue — still correct for
webhook-only debugging.

## 7. Inspect / replay deliveries

ngrok's local inspector at **http://127.0.0.1:4040** shows every delivery and lets you
**replay** one — re-fire the exact same signed payload at your handler while debugging, instead
of opening PRs repeatedly. This is where you **save real payloads as fixtures** for PR A's
re-verification (the parser tests deliberately don't import these, but capturing them keeps the
inline test shapes honest against what GitHub actually sends).
