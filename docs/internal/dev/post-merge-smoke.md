# Reviewer FE post-merge smoke — explicit walkthrough

One continuous end-to-end pass over merged `main`, exercising everything the
reviewer FE stack shipped. Run it top to bottom; each step names the
exact URL/command, what you must see, and where to look when it doesn't.

Estimated time: ~30–40 min including two generation waits.

Every section below carries one disposition tag (ADR 0038 §11). The whole
document sits on the far side of the automated wall by construction: it needs
a real GitHub App, a public tunnel, real webhook deliveries and real token
spend. Nothing here was deleted as `automated:` — what the suites now prove on
their own is listed in the gates index of
[`pre-release-testing.md`](../../dev/pre-release-testing.md), and the assertions that
overlap are called out per step so this pass stays about the wiring rather
than the logic.

---

## 0. Prerequisites

`manual-forever: a registered dev GitHub App, a test repo it is installed
on, and an ngrok tunnel — none of it reproducible hermetically.`

- Dev GitHub App registered (`docs/self-host/github-app.md`), with OAuth
  client id/secret — the same App you used for the webhook and worker loops.
- A **test repository** where that App is installed, with an open PR you can
  push commits to (call it `TESTREPO`, PR `#N`).
- Repo-root `.env` filled per `docs/self-host/compose.md` — including
  `ANTHROPIC_API_KEY` (the worker generates for real in this smoke).
- ngrok installed.

## 1. Start the stack

`manual-until: full-loop E2E (ADR 0038 §4 park — trigger: the first
webhook-spine regression the integration tests miss).`

```sh
# Foreground build — keychain credential helpers fail in sandboxed/backgrounded
# builds, and don't pipe the output (docs/dev workflow note).
docker compose build

docker compose up -d
docker compose ps        # expect: postgres, web, worker — all running
```

- Web app: http://localhost:3000
- Postgres: 127.0.0.1:5432
- Logs you'll be watching: `docker compose logs -f web worker`

Migrations 0004 (`pull_request.title`) and 0005 (`user_settings`) apply on the
web container's first request — you'll see them in the web log.

## 2. Tunnel + App URLs

`manual-forever: a public tunnel origin written into a real App's webhook
and callback settings.`

```sh
ngrok http 3000
```

Copy the `https://<sub>.ngrok-free.app` URL, then in the dev App's settings
(github.com → Settings → Developer settings → GitHub Apps → your dev app):

- **Webhook URL** → `https://<sub>.ngrok-free.app/api/webhooks/github`
- **Callback URL** → `https://<sub>.ngrok-free.app/api/auth/github/callback`

And make the running stack agree with the tunnel:

```sh
# PUBLIC_BASE_URL must equal the ngrok origin or the OAuth callback mismatches.
# Set it in .env, then:
docker compose up -d web
```

ngrok's inspector at http://127.0.0.1:4040 shows every webhook delivery.

## 3. Login (highest-value step — never live-tested)

`manual-forever: a real user-to-server OAuth consent and installation
binding; no hermetic surface can mint one.`

This is the one path no probe could exercise: a real user-to-server OAuth
token and the `/api/inbox` happy path.

1. Open `https://<sub>.ngrok-free.app/` (the ngrok URL, **not** localhost —
   the OAuth redirect returns to `PUBLIC_BASE_URL`).
2. The picker's **Pull requests** section shows a **Sign in with GitHub**
   button. Click it → you land on `/api/auth/github` → GitHub authorize screen →
   back to the picker.
3. **Expect:** the login CTA is replaced by either PR rows or the
   "No pull requests yet" hint. An `__Host-mergebrief_session` cookie is set.

Verify the plumbing directly if the UI looks off:

```sh
# In the browser devtools console (has the cookie):
await (await fetch("/api/inbox")).json()
# expect: { items: [...], counts, repositories } — NOT 502
```

**If it fails:** web log (`docker compose logs web | grep '"evt"'`) — a 502 on
`/api/inbox` means the installation-repositories fetch failed; a 401 loop
means the callback couldn't bind an installation (is the App actually
installed for your user?).

## 4. Picker list

`manual-until: the E2E v2 seeded-session slice`.

On `/` while signed in, **expect per row**: PR title (new rows only —
pre-migration rows say `PR #N` until their next webhook refreshes the title),
`owner/repo #N · state · short-sha`, a status pill (`brief ready` /
`pending` / `generating…` / `no brief yet`), and the row links to
`/repos/<repoId>/pulls/<N>`.

## 5. Fresh generation + wait UX (live transition)

`manual-until: full-loop E2E (ADR 0038 §4 park)` — and real spend until a
fake generator adapter exists.

1. Push a trivial commit to `TESTREPO` PR `#N`:
   ```sh
   git commit --allow-empty -m "smoke: brief-19 wait ux" && git push
   ```
2. Confirm delivery in ngrok inspector (POST `/api/webhooks/github` → 200).
3. **Immediately** open the PR's row from the picker
   (`/repos/<repoId>/pulls/<N>`).
4. **Expect, in sequence, without any manual reload:**
   - the wait card's pending line: "Holding briefly in case more commits
     land. The brief starts generating shortly." while the debounce runs,
     "Other briefs are generating. This one starts when a slot frees up."
     once the job is due with every slot busy, or the generic "Pending: the
     brief will start generating shortly." when the API reports no reason,
     then
   - the phase line with a spinner: "Fetching the pull request…",
     "Generating the brief…", then "Saving the brief…"
     (phase-only — no diff preview yet; known follow-up, base SHA not
     persisted),
   - PR-meta polling every ~4s (Network tab: `GET /api/repos/.../pulls/<N>`),
   - the Brief replaces the card the moment its artifact exists — while the
     worker log may still show delta warmup. If you catch that window, a
     `Comparisons warming…` chip sits bottom-right and clears on the terminal
     poll.
5. **Expect in the URL:** `?rev=<n>` appears (revision pinning) once the
   brief renders.

**If it never leaves pending:** `docker compose logs -f worker` — the generate
job should pick up after the ~60s debounce. No job at all → check the
webhook delivered (ngrok 4040) and the web log for the enqueue.

## 6. Deep link + SSR

`manual-until: the E2E v2 seeded-session slice`. The seeded E2E suite covers first paint and
View/Compare params that are unrecognized or unavailable on the DB-backed
`/repos/<repoId>/pulls/<N>` route; the auth redirect arm stays manual.

1. Entry comment posting ships with the entry-comment change: after a settled push,
   **expect exactly one** branded App comment at the bottom of the PR thread,
   deep-linking the exact span — use it as the deep link for this step. (For
   a brief generated before that change, build the link by hand: copy the pinned
   brief URL.) Open it in a **fresh private window** (no session): **expect**
   an immediate redirect to GitHub login (`/api/auth/github`), and after auth,
   the brief.
2. In the signed-in window, copy the pinned URL
   (`/repos/<repoId>/pulls/<N>?rev=<n>`) into a new tab:
   **expect** brief content in the first paint (View Source shows the group
   titles — that's SSR through the in-process interface) and response header
   `cache-control: no-store` (Network tab → the document request).
3. Malformed-link checks (same tab):
   - `/repos/<repoId>/pulls/99999` → 404 error page.
   - `/repos/<repoId>/pulls/<N>?base=garbage` (lone base) → renders the
     current span; URL rewrites to its `?rev=<n>`.

## 7. Second revision → previous-brief comparison

`manual-until: the E2E v2 compare-bar slice`.

1. Push another commit to the same PR; wait for the new brief (step 5 repeats).
   With entry-comment posting merged, also **expect** the Entry comment REPLACED (old one
   deleted, new one at the bottom of the thread, linking the new head) —
   never two comments.
2. On the new brief, **expect** the compare bar under the banner area:
   `Full Brief / Changes Only` + `Your last review / Previous Brief`.
   - `Previous Brief` **enabled** (the old head's marks exist),
   - `Your last review` disabled with tooltip "No submitted review checkpoint
     yet".
3. Click **Previous Brief**: URL gains `&compare=previous-brief`; highlights
   paint on changed chunks. Network tab shows
   `GET /api/repos/.../marks?baseline=<oldHead>&head=<newHead>` → 200 and,
   if the narrative generated, `GET .../narrative?...` → 200.
   **A "malformed" error state here would implicate the D13 parse synthesis
   — grab the response body.**
4. While the second brief generates, keep the FIRST brief's pinned URL open:
   **expect** the **Newer commits** chip, reading **Generating new brief**
   until the second brief lands and then offering **Go to new brief**, which
   navigates to the new span. The page must never swap under you on its own.

## 8. Access-control spot checks

`automated: pnpm -r test` — the 401-without-session, 404-not-403 for an
inaccessible repo id, and the matching `auth` audit row are asserted against
the real Hono app in `packages/api` (`reads.test.ts`, `repos.test.ts`).
Nothing left to click here.

## 9. Teardown

`manual-forever: tears down the real compose stack this pass stood up.`

```sh
docker compose down          # keep volumes; `down -v` only if you want a clean DB
```

---

## If something breaks

Fix-forward on `main` (small PR, or direct push for one-liners per the
docs-on-main convention). Likely-trouble ranking, with first-look locations:

1. **OAuth** (step 3) — web log `evt` lines; the `auth_session` row.
2. **Poll → render transition** (step 5) — Network tab for the 4s PR-meta
   cadence; `headBriefStored` (and `briefAvailable` for the current base) in the PR-meta JSON vs the worker log.
3. **Comparison client fetch** (step 7) — marks/narrative response bodies vs
   the parse error; `comparison_marks` / `revision_narrative` rows in
   Postgres.
