# Plan — BRIEF-19: FE over the read API — render DB-backed Briefs (post-M1 · close the loop)

> Status: **shipped 2026-07-06** — PRs #31–#41 + smoke fix #42, all merged;
> smoke-tested per `docs/dev/brief-19-smoke.md`. Ticket: Notion BRIEF-19.
> Grill resolved 2026-07-06 (decisions on the ticket); ADR 0016 #4/#5 and
> ADR 0018 D14 amended accordingly (commit `6018ab8`). Delta view + timeline
> navigation split to BRIEF-21. Execution only — no open design questions.

## What this delivers (product + technical context)

**Product:** BRIEF-3 made generation automatic (push → brief in Postgres), but
the only viewing surface is raw JSON from the authz-gated read API. This ticket
closes the loop: a reviewer logs in, picks a PR (or deep-links from a PR
comment), and READS the DB-backed Brief in the real UI — including the
previous-brief comparison — with a live "generating…" wait state when the
worker hasn't finished. After this, the self-hosted product is end-to-end
usable by a human.

**Technical:** four moves. (1) Harden/complete the read path: reintroduce the
60s positive authz cache, split the gate into session + repo-authz layers, add
the two missing discovery endpoints (list, PR-meta). (2) Multi-org sessions:
`user_settings` (D14), default-installation binding, a validated switch
endpoint. (3) FE: an isomorphic `apiFetch` seam (SSR = in-process dispatch of
the same Hono app with the cookie forwarded — never a second authz path),
loader-prefetched brief route, client-side diff slicing, generation-status
poll. (4) Previous-brief comparison availability + rendering over the existing
marks/narrative endpoints.

## Locked decisions this plan implements (do not re-litigate)

- **Hybrid data loading.** The grill weighed three strategies: fully
  server-rendered (loader `ensureQueryData` during SSR — content in first
  paint, gate cost on TTFB), fully client-side (shell first, fetch after
  hydration — no SSR plumbing but a spinner on every deep link), and a
  **hybrid (chosen)**: SSR-prefetch exactly what a deep link points at
  (PR-meta + brief), fetch the heavy/dynamic rest (diff, status poll,
  comparisons) client-side. Deep links from PR comments are the primary
  entry path, which is what killed client-only. SSR'd documents carry
  `cache-control: no-store`.
- **In-process dispatch** for SSR fetches (`getWebhookApp()` → `app.fetch`
  with forwarded session cookie). Server-fn-to-persistence is forbidden
  (bypasses the gate — ADR 0016 #5).
- **Authz cache:** positive-only, 60s TTL, negatives never cached
  (revert+tighten of `05e840a`). Sibling per-session allowed-repo-set cache
  (same constant) for the list endpoint via
  `GET /user/installations/{installation_id}/repositories` (viewer token).
- **Endpoints:** `GET /api/pulls` (flat, cap 100, no cursor);
  `GET /api/repos/:repoId/pulls/:prNumber` (PR meta + `briefAvailable` +
  generation summary — the single poll target); `POST /auth/installation`
  (switch + `setDefault`); `GET /auth/installations` (accessible + current +
  default).
- **Routes:** numeric `/repos/$repoId/pulls/$prNumber`; span via validated
  search params; local `/briefs/*` untouched (dev/demo mode kept).
- **Render trigger = brief artifact EXISTS**, not generation status
  (`markSucceeded` fires only after delta warmup). Status drives
  phase/failed/superseded display; diff-first wait UX (ADR 0006 #10).
- **Fixes folded in:** `markSucceeded` AND `markSuperseded` null the stale
  `phase`; stale positive-cache comments in `reads.ts`.
- **Dedupe:** extract `parseUnifiedDiffPatch` / `sliceChunkDiff` from
  `brief.server.ts` into a pure shared module (client slices the live diff).

## Context for a fresh session (read before PR 1.1)

Load-bearing facts a new session would otherwise have to re-derive:

- **The gate:** `packages/api/src/routes/authz.ts` — single middleware,
  session cookie → session row → expiry → decrypt token → GitHub
  `GET /repositories/{id}` by numeric id → 404 collapse → audit. Commit
  `05e840a` REMOVED a 5-min positive cache (posture, not a bug); PR 1.1
  reinstates it at 60s. `reads.ts` comments still describe the cache-hit
  contract (lazy decrypt + refresh-on-401 in the diff route) — they are
  currently stale but become true again after PR 1.1.
- **Bounded TTL cache:** `packages/api/src/routes/ttl-cache.ts`
  (`createTtlCache`) — reuse it for both new caches; keys are never-reused
  (session hashes), hence the bounding discipline.
- **SSR seam target:** `apps/web/src/server/webhookApp.ts` exposes
  `getWebhookApp()` (memoized Hono app singleton, 5s failure cooldown);
  `apps/web/src/server.ts` routes `/api/*` + `/auth/*` to it in-process.
  The SSR branch of `apiFetch` dispatches against this same app — origin
  string in the synthesized `Request` is irrelevant (Hono routes on path).
- **Worker ordering:** `packages/worker/src/generate.ts` — brief artifact is
  written mid-pipeline; `markSucceeded` fires at line ~527 only AFTER
  revision artifacts + delta-core warmup. Hence render-on-artifact-EXISTS,
  never on `status === "succeeded"`.
- **Multi-install footgun being fixed:** `packages/api/src/routes/auth.ts:317`
  binds the session to `installations.value[0]` ("M1: multi-install selection
  deferred") — PR 2.1 replaces this.
- **Local brief layer:** `apps/web/src/features/brief/brief.server.ts` —
  stays as the dev/demo path; `parseUnifiedDiffPatch`/`sliceChunkDiff` move
  OUT of it (PR 3.1) into a pure shared module because the DB path slices
  the live-proxied diff on the client. Chunk without a `diff` field is a
  legal shape (renderer degrades).
- **Router:** `apps/web/src/router.tsx` — react-query SSR integration already
  wired (`setupRouterSsrQueryIntegration`, fresh `QueryClient` per request).
  Existing route pattern to copy: `apps/web/src/routes/index.tsx` (loader
  `ensureQueryData` + `useSuspenseQuery`).
- **Generation projection:** `packages/persistence/src/generation.ts` —
  `markSucceeded`/`markSuperseded` currently leave a stale `phase` (PR 1.1
  fixes). Natural key is NULLS-NOT-DISTINCT on `baseline_sha`.
- **Workflow notes (from memory):** SSH push is broken — push via the gh
  HTTPS helper; docker builds fail keychain when sandboxed/backgrounded and
  must not be tail-piped; docs-only commits go straight to main (Idan
  pushes), code via PR; enum vocabularies are CHECK-constrained — adding a
  value needs code + migration in lockstep.

## Mandates

**Git — `git-eng` skill for ALL git operations** (branch, commit, push, PR):
- Feature branch per PR: `feature/BRIEF-19/<slug>`; stacked branches when a PR
  depends on an unmerged predecessor (stacked-PR flow; Idan merges).
- No `Co-Authored-By`, no AI-attribution in commits or PR bodies.
- Chunked commits per logical unit within a PR.
- **LOC ceiling is a hard gate** (repo working agreement): measure
  `git diff --stat` against the base after EVERY part; ideal < 500 changed
  LOC, ceiling ~1000. Estimate exceeded → split before continuing, don't
  rationalize. Chores/refactors that balloon get their own PR.

**Specialist skills — mandatory, confirmed 2026-07-06:**
- `typescript-eng` — all parts (strict TS, no enum, Result at boundaries, Zod).
- `tdd` — all api/persistence parts test-first against the PGlite +
  `app.request()` harness; FE logic (queryOptions, slicing module) test-first
  in vitest.
- `vercel-react-best-practices` — FE parts (loader prefetch, suspense, no
  client waterfalls).
- `web-accessibility` — every new UI surface (picker list, wait screen, org
  dropdown): keyboard nav, focus management, ARIA, reduced motion.
- `verify` before committing each nontrivial part (drive the real flow via
  compose or dev server, not just tests).

## Subtasks → PRs

Dependency order: 1.1 → 1.2 → 3.1 → { 3.2 ∥ 2.1 } → 2.2 → 4.1.

### Subtask 1 — Read-path API foundations (`packages/api`, `persistence`, `github`)

**PR 1.1 — `feature/BRIEF-19/authz-cache` (~350–450 LOC)**
Security-boundary work. **Model: Fable, high effort, main thread.**
1. Reintroduce the positive authz cache in `createAuthzMiddleware`: keyed
   `(sessionHash, repoId)`, **60s TTL** (not the old 5min), positive-only,
   bounded via `createTtlCache` (near-revert of `05e840a`; the diff route's
   lazy-decrypt + refresh-on-401 path in `reads.ts` already anticipates
   cache hits — re-read its comments, they describe the contract).
2. Split the middleware into composable layers: `sessionLayer` (cookie →
   session → expiry → ctx) and `repoAuthzLayer` (parse repoId → GitHub check
   → 404 collapse → audit). Existing per-repo gate = composition of both;
   the list endpoint (PR 1.2) reuses `sessionLayer` alone. Same single
   enforcement point, two compositions (ADR 0016 #5 as amended).
3. `persistence`: `markSucceeded` and `markSuperseded` set `phase: null`
   (+ transition tests).
4. Fix stale cache comments in `reads.ts`/`authz.ts`; update
   `packages/api/AGENTS.md` if invariants text mentions recheck-every-read.
Tests first (tdd): cache hit skips GitHub call, expiry re-checks, negatives
never cached, revoked-at-GitHub denies post-TTL, eviction bounds.

**PR 1.2 — `feature/BRIEF-19/list-and-pr-meta` (~600–800 LOC, stacked on 1.1)**
Tenancy-sensitive. **Model: Fable, high effort, main thread.**
1. `github` pkg: `listInstallationRepositoriesForUser(octokit, installationId)`
   → Result of numeric repo-id set (+ verified names), Zod-parsed, paginated
   to the 100 cap.
2. `GET /api/pulls`: `sessionLayer` + per-session allowed-repo-set cache
   (60s, same constant, bounded); tenant query
   `WHERE installation_id = ctx AND repo_id IN (allowed)` ordered
   `updated_at DESC`, `limit` ≤ 100; GitHub failure → 401/502, NEVER a
   DB-only listing (leak). Row shape: `{ repoId, repoSlug, prNumber, title,
   state, baseSha, headSha, briefAvailable, generation, updatedAt }`.
3. `GET /api/repos/:repoId/pulls/:prNumber` (PR-meta): full gate; PR row +
   `briefAvailable` (EXISTS on brief for current span) + latest brief-kind
   generation summary `{ status, phase, attempts, error, updatedAt } | null`.
4. Persistence read seams as needed (`pullRequests.listForRepos`,
   `briefs.existsForSpan`, `generation.latestForHead`) — ctx-bound, tested.
Tests first: tenancy (cross-installation rows never leak), allowed-set
filtering, cap, cache behavior, PR-meta 404 posture identical to artifact GETs.

### Subtask 2 — Multi-org sessions

**PR 2.1 — `feature/BRIEF-19/multi-org-backend` (~500–650 LOC)**
**Model: Opus, high effort. Invocation: subagent (worktree), in parallel with
PR 3.2** — disjoint packages (api/persistence vs apps/web); sequence its merge
after 1.2.
1. Migration + schema: `user_settings` per ADR 0018 D14 (PK `gh_user_id`,
   `default_installation_id` nullable, timestamps). NON-tenant-scoped: new
   `userSettings` seam (NOT under `forTenant`); type-level containment tests
   treat it like `audit`.
2. Login binding: callback binds `default_installation_id` when present in
   the live accessible set, else first accessible (replaces bare `[0]`;
   comment at `auth.ts:323` retired).
3. `POST /auth/installation` `{ installationId, setDefault? }`: re-derive
   accessible set from GitHub with the session's token (refresh-on-401 path
   reused), validate target ∈ set (never trust caller id), update session
   row + optional default, audit row. `GET /auth/installations`: accessible
   list + current + default.
Tests first: switch to inaccessible installation → 403 + no mutation;
default-binding fallback matrix; settings survive session deletion.

**PR 2.2 — `feature/BRIEF-19/org-switcher-ui` (~200–300 LOC, after 3.1 + 2.1)**
**Model: Sonnet, medium effort, main thread.** Header org dropdown (current
installation, switch, set-default toggle) over `GET/POST /auth/installations`;
on switch: invalidate all queries, navigate to picker. Keyboard/ARIA per
`web-accessibility` (menu pattern, focus return).

### Subtask 3 — FE: DB Briefs render (`apps/web`)

**PR 3.1 — `feature/BRIEF-19/fe-data-layer` (~500–700 LOC, after 1.2)**
**Model: Sonnet, high effort, main thread.**
1. `apiFetch` seam: client branch = relative `fetch`; server branch =
   `(await getWebhookApp()).fetch(new Request("http://internal" + path,
   { headers: { cookie } }))` with the incoming request's cookie; composition
   failure → typed error state (mirrors the 503 posture). 401 during SSR →
   redirect to login.
2. `cache-control: no-store` on SSR'd documents (custom server entry or
   route-level header) — private HTML must never be proxy-cached.
3. Extract `parseUnifiedDiffPatch` + `sliceChunkDiff` (+ helpers) from
   `brief.server.ts` into a pure shared module; `brief.server.ts` imports it.
   Characterization harness must stay green — this is a move, not a rewrite.
4. queryOptions for list / PR-meta / brief / diff over `apiFetch`.
5. Root picker: login-aware (session → DB PR list leads, using the list
   endpoint; login CTA otherwise); local Briefs section demoted below,
   unchanged behavior.
Tests: seam unit tests (cookie forwarding, error mapping), extracted-module
unit tests (moved cases), picker states.

**PR 3.2 — `feature/BRIEF-19/fe-brief-route` (~650–900 LOC, stacked on 3.1)**
**Model: Sonnet, high effort, main thread — Fable reviews the wait-UX state
machine before commit.**
1. Route `/repos/$repoId/pulls/$prNumber`: loader `Promise.all` over
   `ensureQueryData(prMeta)` + conditional `ensureQueryData(brief)` (only when
   span known/available — no waterfall); `validateSearch` (Zod: optional
   `base`/`head`, default = PR row span).
2. Brief renders through the EXISTING renderer components (source-agnostic);
   chunk diffs: client fetches `/diff?base&head`, slices via the shared
   module, degrades gracefully while loading (chunk without `diff` is legal).
3. Generation wait UX: poll PR-meta with `refetchInterval` as data-function
   (3–5s while `!briefAvailable && generation` non-terminal, off otherwise).
   State map: no row + no brief → empty state (+ activation hint, ADR 0020);
   queued/running → **diff-first wait** (render the live diff + phase label);
   failed → sanitized error + attempts; superseded → "newer revision on the
   way", keep polling; briefAvailable → render brief immediately (+ subtle
   "comparisons warming" chip while status still running).
4. Head-advance mid-view: PR-meta refetch surfaces the new head; banner offers
   navigation to the new span.
Accessibility: wait-state announcements (`aria-live=polite`), focus handling
on state swap, reduced-motion on any spinner.

### Subtask 4 — Previous-brief comparison over DB

**PR 4.1 — `feature/BRIEF-19/prev-brief-comparison` (~550–700 LOC, stacked on 3.2)**
**Model: Sonnet, high effort, main thread.**
1. API: PR-meta response grows `comparisons.previousBrief`
   `{ baselineSha, baselineIndex?, narrativeAvailable } | undefined` —
   derived from `comparison_marks` rows for the current head (previous-brief
   span family) + `revision_narrative` EXISTS. Additive; shape leaves room
   for BRIEF-21's `lastReview`.
2. FE: comparison surface wired to `GET .../marks?baseline&head` +
   `GET .../narrative?prevHead&head` via queryOptions; reuse the existing
   comparison renderer; client-side on-demand (no SSR).
3. Availability absent → comparison UI simply not offered (fail-closed like
   the local path).
Tests: availability derivation (no marks → absent; marks w/o narrative →
`narrativeAvailable: false`), tenancy on the new queries, FE state wiring.

## PR budget sanity

| PR | Est. LOC | Gate |
|---|---|---|
| 1.1 authz-cache | 350–450 | measure after step 2; if the layer split balloons, split it out |
| 1.2 list + PR-meta | 600–800 | if > 900 with tests, split PR-meta into its own PR |
| 2.1 multi-org backend | 500–650 | migration + seam vs auth routes is the natural split line |
| 2.2 org switcher UI | 200–300 | — |
| 3.1 fe-data-layer | 500–700 | extraction (step 3) is the split candidate if > 900 |
| 3.2 fe-brief-route | 650–900 | wait UX (step 3) splits off if > 1000 |
| 4.1 prev-brief comparison | 550–700 | api vs fe halves if > 900 |

## Verification (every PR)

```sh
pnpm -C packages/<touched> typecheck && pnpm -C packages/<touched> test
pnpm -C apps/web typecheck && pnpm -C apps/web test   # FE PRs (characterization included)
pnpm lint
```

End-to-end (`verify` skill): `docker compose up` + real-key smoke — push to a
test PR, watch the picker show it, open the brief, observe wait UX on a fresh
push, switch org, open the previous-brief comparison. Keychain/BuildKit
caveats per the docker-builds workflow note (no sandboxed/backgrounded builds).
