---
name: verify
description: Drive this repo's API/web surface end-to-end locally — postgres, env wiring, session seeding, and the gotchas — to verify changes at runtime instead of re-running tests.
---

# Verifying changes at the runtime surface

The HTTP surface (webhook, auth, read API) is served by `apps/web`'s dev
server, which mounts the `api` Hono app in-process (`src/server.ts` →
`getWebhookApp()`).

## Launch

```sh
docker compose up -d postgres          # loopback Postgres (matches .env.example URL)
set -a; source .env; set +a            # root .env: GitHub App/OAuth creds + SESSION_KEY_V1 (agents: see gotcha below)
DATABASE_URL=postgres://code_review:code_review@127.0.0.1:5432/code_review \
  pnpm -C apps/web dev                 # port 3000; run in background, log to a file
```

Gotchas:

- `DATABASE_URL` is NOT in any `.env` — pass it explicitly (value above, from
  `.env.example`).
- Secrets split: root `.env` has the GitHub/auth vars; `apps/web/.env` has only
  `ANTHROPIC_API_KEY`. The composition root loads cwd `.env` then ambient env,
  so source the root one into the shell.
- Agents cannot read OR `source` `.env` — the `Read(./**/.env)` deny rule blocks
  both. Don't fight it: generate synthetic parse-only secrets instead. The read
  path only needs values that PARSE (auth happens via the viewer's `gh` token):
  a fresh `SESSION_KEY_V1`, a throwaway RSA PEM for the GitHub App key, and
  placeholder App/OAuth ids. Export those and skip the `source` line entirely
  (verified working, BRIEF-24 smoke 2026-07-08). Never print real `.env` contents.
- First request builds the app (runs migrations); a bad env fails loudly on
  that request, not at boot.

## Seeding an authorized reviewer session (read-API verification)

No OAuth round-trip needed: seed a `reviewer_session` row whose access token is
the local `gh` CLI token (`gh auth token` — can read any repo the user owns).
Write a throwaway `.mts` script INSIDE `apps/web` (workspace resolution;
`.mts` because scratchpad/plain `.ts` is transpiled CJS and top-level await
fails), using `persistence`'s `migrateApp`, `encryptToken`, `envKeyProvider`,
`forTenant(...).sessions.create` / `pullRequests.upsert`, `artifactStore`.
Pass the token via env var; print only the cookie value. Use a sentinel
`installation_id` (e.g. 777001) so cleanup can be tenant-scoped deletes.
Run with `pnpm -C apps/web exec tsx <script>`; delete the script after.

Then drive with curl: `-H "Cookie: rs_session=<cookie>"` against
`/api/repos/:repoId/pulls/:prNumber/brief?base=..&head=..`.

Useful probes:

- Authz-cache hit is visible as latency (~400ms GitHub round-trip vs <15ms)
  and provable by corrupting `gh_token_ciphertext` in the DB — a cache hit
  skips the decrypt, so the read still 200s inside the TTL and 401s+burns the
  session after it.
- Repo id `1` is PUBLIC (mojombo/grit) — useless as a "no access" probe; use a
  huge nonexistent id (`99999999999`) to hit the 404-collapse + audit path.
- D9 access lines (`{"evt":"read",...}`) are on the dev server's stdout;
  audit rows in `audit_log` (`docker compose exec -T postgres psql -U
  code_review -d code_review`).

## Cleanup

Once the verify passes are done, KILL the dev servers — the whole tree, not
just the launched PID: `pnpm dev` leaves a pnpm wrapper (sometimes two) plus
the vite child running after the parent dies. Find and kill them all, then
confirm zero remain:

```sh
ps aux | grep -iE "vite|pnpm.*dev" | grep -v grep   # expect pnpm wrapper(s) + vite
kill <pids>
ps aux | grep -iE "vite|pnpm.*dev" | grep -v grep | wc -l   # must print 0
```

Then tenant-scoped deletes only (the dev DB may hold real webhook-loop data),
then `docker compose stop postgres` if it was down before. Blanket
`DELETE FROM` is hook-blocked.

## Seed-script gotchas (BRIEF-52 pass, 2026-07-17)

- `createDb(databaseUrl)` and `migrateApp(databaseUrl)` take the URL STRING,
  not an options object; `encryptToken(provider, keyRef, plaintext)` — provider
  first.
- Sessions have no high-level helper: `sessions.create` wants the sha256-hex
  hash of a random token (cookie value = the raw token), reviewer id, BOTH
  ciphertext fields, `keyRef`, `expiresAt`.
- `SESSION_KEY_V1` must be base64-encoded 32 bytes (`openssl rand -base64 32`)
  — hex is "wrong-length".
- Use a REAL repo id the `gh` token can read (e.g. `gh api repos/<o>/<r> --jq
  .id`): the authz gate resolves the id against GitHub, so a made-up id 404s
  every read.
- Browser pass: seed the interesting artifact on the LATEST head — `?head=`
  deep-links degrade to latest when meta returns no revisions[].
