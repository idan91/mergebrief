# Plan — BRIEF-2: GitHub App, Webhooks, Auth & Read API (P4/M1 · WS2)

> **Ticket:** BRIEF-2 (Notion board) · **Status:** planned, not started.
> Executes workstream 2 of `product-backend-epic.md` against the ADRs **as amended
> 2026-07-05** (BRIEF-2 pre-build grill): ADR 0006 #4/#6, ADR 0018 banner + D5/D10/D11.
> Decisions live in the ADRs — **do not re-derive them here; contradiction → stop and amend
> the ADR first.** Grill record: the BRIEF-2 Notion ticket.
> A consolidated system-design doc is a logged follow-up (root `todo.md`) once BRIEF-3 lands.

Grounding: ADR 0016 (App/auth/tenancy) · ADR 0020 (trigger/entry) · ADR 0006 as amended
(generation/cancellation) · ADR 0018 as amended (schema) · ADR 0024 (compare bundle) ·
`docs/self-host/github-app.md` (App registration — already done for dev) ·
`packages/persistence` (BRIEF-1 surface: tenant repo, artifact store, sessions, crypto).

## The seam (agreed in grill 1)

**BRIEF-2 = ingest + identity + read surface.** Complete and testable with **zero LLM calls**:
webhooks land → rows + queued jobs visible in Postgres; OAuth login → session row; read API →
correct 401/403/404/200. **BRIEF-3 = compute + notify + package**: the worker consumes the
queued jobs, writes artifacts, posts the Entry comment (via BRIEF-2's client), compose
packaging, and the FE switch from static JSON to the live API. No FE work in BRIEF-2.

## Key decisions this plan implements (grill outcomes)

1. **One job kind.** Every generation-relevant event (`push`/`synchronize`,
   `ready_for_review`, `review_requested`, `pull_request_review` submit) enqueues
   `generate`, `job_key = generate:{pull_request_id}`, `run_at = now + 60s` — graphile's
   job-key replacement of the *pending* job is the trailing debounce. Handlers encode **no
   artifact logic**; the worker derives the bundle from state (BRIEF-3). Web enqueue writes
   the one `generation` row it can know: `(kind: brief, head)` queued, transactional with the
   data write.
2. **Schema additions (one migration, 0003):** `pull_request.entry_comment_id` (D5),
   `reviewer_session.gh_refresh_token_ciphertext` (D11), `generation.status` gains
   `superseded` (vocab CHECK updated in lockstep — drop + re-add constraint).
3. **Auth = `@octokit/oauth-app`** (GitHub-official; Arctic fallback): expiring user access
   token (~8h) + rotating refresh token (~6mo), **both encrypted** with BRIEF-1's
   `encryptToken`. Lazy refresh at next use, **serialized per session** (`SELECT … FOR
   UPDATE`), any failure → delete session → redirect re-login. Ceiling = GitHub's rotation
   limit + TTL sweep; no extra cap.
4. **Authz gate** (ADR 0016 #5): single middleware; `GET /repositories/{repo_id}` with the
   *viewer's* token (by id — rename-proof); non-200 → **404** (no existence leak); denials
   emit the D9 `auth` audit entry. **In-memory positive cache** `(session, repo_id)` ~5 min;
   negatives uncached. Access log = structured stdout (D9's purgeable log; no table).
5. **Layout:** new `packages/github` (octokit wiring, App JWT + installation tokens, webhook
   HMAC verify, Zod-typed event parsing, comment post/delete, diff/PR fetch, repo-access
   check — **no DB imports**) and new `packages/api` (**Hono app**: webhook route, auth
   routes, read routes; imports `github` + `persistence`), mounted into `apps/web` via one
   catch-all server route. One origin (one ngrok tunnel serves webhook + OAuth callback), no
   CORS, lift-out seam preserved. ADR 0015 topology unchanged — this is packaging.
6. **Documented-not-built knobs** (named in code comments where they'd land, never
   implemented): `on-first-view` trigger, `max-checkpoints-per-bundle`, refresh-token
   session cap.

## PR split (agreed: multiple PRs for reviewability)

| PR | Branch | Contents |
|---|---|---|
| **A** | `feature/BRIEF-2/github-client` | `packages/github` complete + fixture-based unit tests |
| **B** | `feature/BRIEF-2/webhook-ingest` | migration 0003 · `packages/api` scaffold (Hono) + webhook route → tenant writes + enqueue · graphile-worker enqueue-side dep · `apps/web` mount |
| **C** | `feature/BRIEF-2/reviewer-auth` | OAuth routes + session/refresh flow · authz middleware + caches · read API routes (brief/marks/narrative/diff-proxy) |

Each PR independently green (typecheck, tests, lint, CI); B depends on A, C on B. CI: add
`github` and `api` packages to the persistence-style matrix jobs in the PR that creates each
package.

## Stages (= commits within the PRs), with model routing

| # | PR | Stage | Model | Effort | Rationale |
|---|---|---|---|---|---|
| 1 | A | `packages/github` scaffold + App auth (JWT, installation tokens) | Sonnet | low | mirrors persistence scaffold; octokit-documented patterns |
| 2 | A | webhook verify + Zod event schemas + comment ops + diff/repo fetch | Opus | medium | boundary parsing discipline; fixture tests |
| 3 | B | migration 0003 + vocab lockstep (`superseded`, new columns) | Opus | high | schema change against CHECK constraints; follows 0002 pattern |
| 4 | B | Hono app scaffold + webhook route: verify → tenant writes → enqueue (transactional) + `generation` queued row; installation-event handlers → purge routines | **Fable** | high | the trust boundary: signature verify, tenant derivation from payload, event→state mapping — highest blast radius in the ticket |
| 5 | B | `apps/web` catch-all mount + dev-loop docs (ngrok) | Sonnet | low | plumbing |
| 6 | C | OAuth routes + session create + **serialized refresh** | Opus | high | rotation race + crypto integration; security-sensitive |
| 7 | C | authz middleware + positive cache + audit denials + read routes + diff proxy w/ per-session cache | Opus | high | the authz gate is ADR 0016 #5's single enforcement point |

Per-commit gates unchanged from BRIEF-1: typecheck + tests + lint green, then
`security-reviewer` on staged changes (findings ≥ 80 → fix, re-gate), then commit. Stage
handoffs carry no conversational context — each stage's brief is this plan + the amended
ADRs + the D-refs above.

## Requirements — TypeScript (carried from BRIEF-1, unchanged)

Strict tsconfig mirrored from `tools/categorizer`; no `enum` (`as const` + `ValueOf`, keys
SHOUT_CASE / values kebab-case); no `any`, no bare `as` — Zod at every boundary (webhook
payloads, OAuth callbacks, env config); branded ids from `persistence`; `Result` for expected
failures (verify failure, refresh failure, authz denial); named exports; extensionless
relative imports; noun factories / verb-first actions; oxlint + prettier per repo convention.
Each new package gets `AGENTS.md` + one-line `CLAUDE.md` (`@AGENTS.md`), persistence-style.

## Requirements — Git (locked)

Branches per the PR table; conventional-commit chunks per stage table; **never**
`Co-Authored-By` or AI attribution; PR titles `[BRIEF-2] feat: …` (ready-for-review, base
`main` — A/B/C stack via retarget after merge or rebase-on-merge, whichever keeps diffs
clean); security gate before every commit. Notion: BRIEF-2 → In progress at stage 1; → Done
when PR C merges.

## Testing

- `packages/github`: unit tests against **recorded webhook fixtures** (real payloads captured
  via ngrok inspector — pull_request opened/synchronize/closed/reopened/ready_for_review/
  review_requested, pull_request_review submitted, installation created/deleted,
  installation_repositories removed) + HMAC verify vectors (valid/invalid/replayed) + comment
  op behavior via injected octokit mock (existing dep pattern only — no new mock libs).
- `packages/api`: **integration tests = `app.request()` against PGlite** (BRIEF-1 helper
  pattern): webhook POST with valid signature → `pull_request` row + queued job +
  `generation` row, idempotent on redelivery; invalid signature → 401, no writes;
  `installation` deleted → purge invoked (tenant-scoped, audit emit); auth flow with octokit
  exchange mocked at the HTTP seam; refresh race test (two concurrent expired-session
  requests → one exchange, both succeed); authz gate 200/404/401 shaping + cache behavior
  (second read within TTL → no GitHub call); denial → audit row.
- Graphile enqueue asserted at the DB level (row in `graphile_worker.jobs` with the right
  `job_key`/`run_at`) — no worker runs in BRIEF-2.
- Manual smoke per PR B/C: compose Postgres + ngrok + the dev App → open a real PR on the
  installed repo → verify rows; login via browser → session row; curl reads.

## Verification (every stage)

```
pnpm -C packages/github typecheck && pnpm -C packages/github test
pnpm -C packages/api typecheck && pnpm -C packages/api test
pnpm lint
```

Plus migration 0003 smoke on compose Postgres (fresh volume) in PR B, BRIEF-1 style.
