# Local webhook loop

How to run the webhook receiver end-to-end on your machine and watch a real GitHub
`pull_request` event turn into a `pull_request` row + a queued `generate` job. This is also
the **fixture-capture** step: the real payloads you replay here are what the webhook parser's
test shapes are checked against, so grab a few while you have the tunnel open.

> Prereq: a **dev** GitHub App registered and installed on a test repo; see
> [`../self-host/github-app.md`](../self-host/github-app.md). Use the App's dev credentials
> here; never paste production secrets into a local `.env`.

## 1. Start Postgres

```sh
docker compose up -d postgres
```

This brings up the loopback-only Postgres from `docker-compose.yml`
(`postgres://code_review:code_review@127.0.0.1:5432/code_review`).

## 2. Configure `apps/api/.env`

The credentials belong to the API process, not the web tier. Copy
`apps/api/.env.example` to `apps/api/.env` and fill in the dev-App values. **Placeholders
below; never commit real values.**

```sh
# Database (matches docker-compose.yml)
DATABASE_URL=postgres://code_review:code_review@127.0.0.1:5432/code_review

# GitHub App (dev registration)
GITHUB_APP_ID=123456
# Exactly ONE of the next two: the inline PEM, or a path to the .pem file:
GITHUB_APP_PRIVATE_KEY_PATH=./secrets/dev-app.private-key.pem
# GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=<output-of-openssl-rand-hex-32>
GITHUB_OAUTH_CLIENT_ID=Iv1.replace-me
GITHUB_OAUTH_CLIENT_SECRET=replace-me
GITHUB_APP_SLUG=your-app-slug

# The public origin: your ngrok URL once the tunnel is up (step 4)
PUBLIC_BASE_URL=http://localhost:3000
# openssl rand -base64 32
SESSION_KEY_V1=<your-base64-32-byte-key>
```

The API's composition root (`apps/api/src/main.ts`) reads these at BOOT, not on the first
request: it parses every config block, resolves the session key, migrates, and only then
listens. A missing or invalid var stops the process with a `field: reason` line instead of
serving a broken webhook, so if `pnpm dev` shows the api pane exiting immediately, that
line is why.

The web tier needs none of this. Under `vite dev` it reads `MERGEBRIEF_API_ORIGIN` and
`LOG_LEVEL` from `apps/web/.env`. `PUBLIC_BASE_URL` matters there only to vite's host guard,
which reads it from the ambient environment when the dev server boots, before that file
loads: export it in the shell. (The production web server, `src/serve.ts`, does read it from
the file.)
The dev-only `MERGEBRIEF_OUT_DIR` in `apps/api/.env` serves local briefs only to a signed-in
session, so the tunnel does not expose it to a cookieless visitor; leave it unset and Home
lists rows alone.

## 3. Run the app

```sh
pnpm dev            # api on http://127.0.0.1:3001, web app on http://localhost:3000
```

Two processes now. The webhook route lives on the API (`POST /api/webhooks/github`), and the
web tier's server entry (`apps/web/src/server.ts`) proxies `/api/*` to it, streaming the raw
body so the HMAC still verifies over the bytes GitHub signed. Point the tunnel at the web
origin as before: nothing about the public URL changes.

Do not judge load time on a dev server. A large brief opens 2 to 3x slower there than in
production: React's development build records every render for its performance track, and
Vite serves about 1,150 unbundled modules after a 7 to 10 s cold start. `pnpm app:host` runs
the dev web tier with hot reload; `pnpm app:host:prod` runs the same api and worker beside a
production build of the web tier on 127.0.0.1. The web `start` script sets `NODE_ENV=production`,
so the server render loads React's production build, as the image does. That is the one to time:

```sh
pnpm app:host:prod  # postgres, root .env, builds apps/web, then api :3001, worker, web 127.0.0.1:3000
```

Then open the brief in Chrome with DevTools' Network panel and read the
`/api/repos/<id>/pulls/<n>/diff` request's start and end, and the Performance panel's long tasks
after it lands. With the api already running, this restarts only the web tier:

```sh
pnpm -C apps/web build && MERGEBRIEF_WEB_HOST=127.0.0.1 pnpm -C apps/web start
```

## 4. Open a public tunnel

```sh
ngrok http 3000
```

GitHub rejects `localhost`, so it must reach you through a public URL. ngrok (not
`gh webhook forward`) is the recommended tunnel because the app also needs the OAuth callback
publicly reachable, and one tunnel serves both. See the rationale in
[`../self-host/github-app.md`](../self-host/github-app.md#webhook).

Set the dev App's **Webhook URL** to:

```
https://<your-ngrok-subdomain>.ngrok-free.app/api/webhooks/github
```

(Free ngrok URLs change on restart; expect to re-paste. The **Webhook secret** in the App
settings must equal `GITHUB_WEBHOOK_SECRET`, or every delivery fails the HMAC check with 401.)

## 5. Fire an event

Open, push to, reopen, or mark-ready a PR on the installed repo. GitHub sends a
`pull_request` delivery; the handler verifies the HMAC over the raw body, upserts the PR, and
enqueues one debounced `generate` job, all fast, before returning 200.

## 6. Verify the write path

```sh
docker compose exec postgres psql -U code_review -d code_review \
  -c 'select repo_slug, pr_number, state from pull_request order by updated_at desc limit 5;' \
  -c 'select task_identifier, key, payload from graphile_worker.jobs order by created_at desc limit 5;'
```

Expect a `pull_request` row for your PR and a `graphile_worker.jobs` row with
`task_identifier = generate` and `key = generate:<pull_request_id>`.

The queue also **drains**: run the worker (`pnpm -C apps/worker start`
with the same env, or the compose `worker` service; see
[`../self-host/compose.md`](../self-host/compose.md)) and the job disappears after the
debounce, the `generation` row walks `pending → running → succeeded`, and the Brief lands in
the `brief` table. Without a worker running, the row sits in the queue, which is still correct for
webhook-only debugging.

## 7. Inspect / replay deliveries

ngrok's local inspector at **http://127.0.0.1:4040** shows every delivery and lets you
**replay** one: re-fire the exact same signed payload at your handler while debugging, instead
of opening PRs repeatedly. This is where you **save real payloads as fixtures** for re-verifying the
webhook parser (the parser tests deliberately don't import these, but capturing them keeps the
inline test shapes honest against what GitHub actually sends).
