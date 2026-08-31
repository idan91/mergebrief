# Plan — BRIEF-98: Pasted-URL briefs move into the database

> Status: **LOCKED — grill closed 2026-08-23 (decisions on the Notion ticket), plan written 2026-08-24, not started.**
> Ticket: Notion BRIEF-98. No wayfinder map — the grill settled the route.
> Estimate held: 6-PR stack.

## What this delivers

**Product:** a pasted-URL brief becomes a first-class brief. It lives in
Postgres, renders on the same repo route as App-installed briefs, and gets the
full feature surface — review sessions, drafts, conversation, thread
resolution, review submit, revisions with comparison marks. The home-page
"Local Briefs" file list, the read-only `/briefs/` pages, and the compose bind
mount all retire. Existing file artifacts are ingested into DB rows once; the
file format survives only as the CLI's output and the ingest tool's input.

**Technical:** five moves. (1) Tenancy becomes honest: `installation_id`
turns nullable, `pull_request` gains `owner_user_id` and `source`
(`app-installation` / `url-box`), and the tenant helpers grow an owner-scoped
ctx. (2) Generation moves to the worker: the URL door enqueues a job carrying
a `github_grant` reference; the worker decrypts lazily, fetches with the
viewer's token (PAT backstop preserved), and runs the existing generate
pipeline — spend caps, status projection, revisions all apply for free.
(3) The API door is rewired: `POST /api/generate` upserts a user-owned
`pull_request` row and enqueues; the signed-out `gh`-CLI door dies; an
owner-delete operation lands. (4) The web app gains a DB-backed "your briefs"
home list and renders personal briefs on `/repos/$repoId/pulls/$prNumber`.
(5) An ingest tool moves disk artifacts into DB rows (explicit target:
existing tenant where installed, else user-owned); e2e fixtures become seeded
DB rows; then the entire web file path is deleted.

## Locked decisions (Notion ticket — do not re-litigate)

Gist index; the ticket carries the full list.

1. Ingest existing `tools/categorizer/out` artifacts + retire the web file
   path, both in this effort. Files stay as CLI interchange; the ingest tool
   is the test on-ramp.
2. `owner_user_id` recorded; instance-visible; no visibility gating until
   hosted is real.
3. Generation runs in the worker — the web tier gains **no** DB brief-write
   path. Token transport = `grant_id` reference + lazy decrypt (no token
   material in the queue).
4. Honest tenancy: nullable `installation_id`, no sentinels; `source` column
   rides audit entries too.
5. Two doors stay parallel — no auto-migration when the App later lands on a
   repo; the App door wins for rendering.
6. Spend: the worker's daily per-repo cap now covers URL generation; no
   per-user cap; `MERGEBRIEF_URL_BOX_TOKEN` PAT backstop stays.
7. Signed-out door dies — the URL box requires sign-in.
8. Ingest targets the real tenant where an installation exists for the repo
   (all current artifacts qualify); user-owned is the fallback; explicit
   target flag.
9. Full revision support through the URL door.
10. Deletion: owner-delete operation riding FK cascades; no retention sweeps.
11. Personal briefs render on the repo route; home page gets a DB-backed
    "your briefs" list replacing Local Briefs.

**Accepted consequence:** Summary Preview is a file-path-only feature (hidden
for `db:` ids today) and dies with the path. Revisit only if missed.

## Recon anchors (verified 2026-08-23)

- URL box today generates **in-process in the web tier** — signed-in via
  `packages/api` `routes/generate` → `apps/web` `urlBriefEngine.server.ts`;
  signed-out via server fns + local `gh`. Both bypass every spend cap.
- Tenancy is `tenantColumns` (`packages/persistence/src/schema/columns.ts`) —
  bare `bigint NOT NULL`, app-enforced, no FK, no installation table.
- Identity is GitHub's numeric user id; `github_grant` is deliberately
  tenant-free and already encrypted at rest — the worker reuses that key
  provider.
- The single brief writer is `packages/worker/src/task/generate.ts` via
  `createArtifactStore`; spend gate sits in the same task before any provider
  call.
- Per-repo authz (`routes/authz.ts`) checks with the **viewer's own token by
  repo id** — it already works for repos with no installation.
- The allowed-repos list is fail-closed on installation ∩ viewer access —
  URL-brief repos will never appear there; the home list is the discovery
  surface.
- Local Briefs list memoizes at boot (fresh briefs invisible until restart) —
  dies with the glue, do not fix en route.
- Playwright points `MERGEBRIEF_OUT_DIR` at `apps/web/e2e/fixtures/briefs`;
  those fixtures must become seeded DB rows before the file path is deleted.

## Mandatory skills + git rules

- **git-eng** must be invoked explicitly for all git operations. Chunked
  commits per logical unit; **performance-reviewer + security-reviewer** run
  on staged changes before every commit (findings ≥80 confidence → fix,
  re-stage, re-run until clean). No `Co-Authored-By` trailers, no AI
  attribution in commits or PR bodies.
- **typescript-eng**, **tdd** (test-first on persistence/tenancy and the
  ingest tool), **verify** (runtime end-to-end drive after the stack lands).
- Stacked PRs, one branch per PR (`feature/BRIEF-98/<slug>`), each PR
  reviewed by a reviewer subagent before publish; Idan merges.
  PR titles `[BRIEF-98] <prefix>: Title Case`. Unslop pass on every PR body.
- Gates per PR: package lint + test (coverage floors ride inside
  `pnpm test`), per-branch lint on the stack. **No eval run** — the
  generation surface (prompt, schema, validators, adapter defaults) is not
  touched; if any part drifts into it, stop and hand the eval commands to
  Idan (never self-run).

## PR stack

Order: 1 → 2 → 3 → 4 → 5 → 6. PR 5 (ingest + fixtures) must land before
PR 6 (deletion) or e2e goes red.

### PR 1 — Honest tenancy (persistence)

`installation_id` nullable across `tenantColumns`; `pull_request` gains
`owner_user_id bigint` (nullable — exactly one of installation/owner set,
CHECK constraint) and `source` (`app-installation` default / `url-box`;
as-const map + `ValueOf`). Uniqueness: existing
`(installation_id, repo_id, pr_number)` kept for tenant rows; partial unique
`(owner_user_id, repo_id, pr_number)` where `installation_id IS NULL`.
Tenant helpers (`createTenantRepository`, `createArtifactStore`, purge ctx)
grow an owner-scoped ctx variant so every query declares which world it
serves. Audit entries carry `source`. Migration + store/test updates.

- Est: ~700–900 LOC (migration + helper seam + tests). Split trigger: if the
  helper seam alone clears ~600, carve the migration into its own lead PR.
- Model: **Fable 5, high effort, main thread** — this is the design-heavy PR.

### PR 2 — Worker: viewer-token generation

Job payload for `url-box` PRs carries `grant_id`; the worker resolves the
grant, decrypts lazily via the existing key provider, and builds the
reviewer-octokit `PrSource` (port the fetch logic from
`urlBriefEngine.server.ts`; PAT backstop `MERGEBRIEF_URL_BOX_TOKEN` moves
here). The generate task runs unchanged downstream — spend cap, status
projection, revisions, narrative.

- Est: ~500–700 LOC. Model: **Fable 5, high** (token handling + engine port).

### PR 3 — API: enqueue door + owner delete

`POST /api/generate` rewired: session-gated → parse URL → resolve repo via
viewer token → upsert user-owned `pull_request` (`source: url-box`) → enqueue
(`job_key` dedupe, trailing debounce as the App door) → return PR coords for
polling. Signed-out generation path deleted. New owner-delete operation
(`private-write`, owner-checked, FK cascades). Wire error codes + i18n
templates per the api recipe.

- Est: ~400–600 LOC. Model: **Opus 5, high, main thread**.

### PR 4 — Web: your-briefs list + repo-route rendering

Home page: DB-backed "your briefs" list (owner = viewer) replacing the Local
Briefs list, linking to `/repos/$repoId/pulls/$prNumber`; URL-box submit
navigates there and polls the existing generation projection. Verify the
repo-route loaders + brief-target resolution over owner-scoped rows (should
be PR-row-keyed already; fix what assumes an installation). Delete affordance
on owned briefs.

- Est: ~400–700 LOC. Model: **Opus 5, high, main thread**.

### PR 5 — Ingest tool + e2e reseeding

Script (CLI-adjacent, direct persistence access like the verify-skill seed
recipe): read `.brief.json` + sidecars → `pullRequests.upsert` +
`createArtifactStore` writes under an explicit `--target
installation:<id> | user:<gh-id>`; idempotent re-runs. Convert playwright
fixtures from `MERGEBRIEF_OUT_DIR` files to DB seeding through the same tool.
Run the one-time ingest of the ~19 local briefs (Idan's tenant).

- Est: ~500–900 LOC (e2e harness rework is the wildcard). Split trigger: if
  the playwright rework clears ~400 on its own, it becomes PR 5b.
- Model: **Opus 5, high**. TDD on the ingest mapping.

### PR 6 — Retire the web file path

Delete `/briefs/` routes (+ summary-preview route), local brief server
readers/handlers/server fns, Local Briefs queries + list UI, compose bind
mounts (`docker-compose.yml`, `docker-compose.external-db.yml`), web-side
`MERGEBRIEF_OUT_DIR` plumbing (CLI keeps its out dir). Sweep `.env.example`,
AGENTS/docs mentions. i18n keys for the read-only file path retire.

- Est: deletion-heavy, ~300 added / large removed. Model: **Opus 5, medium,
  main thread** — mechanical, but run the full web suite + knip.

## Sequencing + invocation

Strictly sequential in the main thread (each PR builds on the last; stacked
branches). No parallel subagent implementation — reviewer subagents only.
After PR 6: run **verify** end-to-end (paste URL signed-in → worker generates
→ repo route renders with session/submit), then the stack goes to Idan for
merge; babysit with watch-pr-stack on request.

## Implementation steps (per PR)

1. `git-eng`: branch off the stack tip.
2. TDD where the part owns logic (PR 1, 2, 3, 5): failing test first.
3. Implement; chunked commits; performance + security reviewers pre-commit.
4. Package gates + per-branch lint; reviewer pass; fix medium+.
5. Publish PR (stacked base), unslopped body; pause for Idan's review cadence.
