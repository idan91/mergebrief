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
set -a; source .env; set +a            # root .env: GitHub App/OAuth creds + SESSION_KEY_V1
DATABASE_URL=postgres://code_review:code_review@127.0.0.1:5432/code_review \
  pnpm -C apps/web dev                 # port 3000; run in background, log to a file
```

Gotchas:

- `DATABASE_URL` is NOT in any `.env` — pass it explicitly (value above, from
  `.env.example`).
- Secrets split: root `.env` has the GitHub/auth vars; `apps/web/.env` has only
  `ANTHROPIC_API_KEY`. The composition root loads cwd `.env` then ambient env,
  so source the root one into the shell.
- Reading `.env` contents is blocked by policy — `source` it, never print it.
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

Tenant-scoped deletes only (the dev DB may hold real webhook-loop data), then
`docker compose stop postgres` if it was down before. Blanket `DELETE FROM` is
hook-blocked.
