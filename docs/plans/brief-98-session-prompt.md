# Session prompt — BRIEF-98 implementation (paste into a fresh session)

Implement BRIEF-98 end-to-end: the full 6-PR stack in
`docs/plans/brief-98-url-briefs-into-db.md` (on main, commit 4536f9dbf). Read
the plan first — it is LOCKED: the grill decisions on the Notion ticket
(BRIEF-98, "Move pasted-URL briefs into the database...") are settled; do not
re-litigate them, do not shrink or expand scope. Memory file
`brief-98-grill-2026-08.md` carries the recon facts.

Run hands-off: build all six PRs, publish the stack, run the runtime verify,
then STOP and hand the finished stack to me for review. I merge; you never
merge. Do not start any post-merge work.

## Ground rules (standing, from my feedback)

- Invoke git-eng for all git operations. Branches: `feature/BRIEF-98/01-tenancy`
  … `06-delete-file-path` (numbered, ticket-prefixed). Chunked commits per
  logical unit. performance-reviewer + security-reviewer on staged changes
  before every commit. No Co-Authored-By trailers, no AI attribution anywhere.
- Skills mandatory: typescript-eng, tdd (persistence/tenancy, worker token
  path, API door, ingest mapping), verify (end of stack).
- reviewer subagent on every PR before publishing. Review budget: 2
  rounds max; iterate on medium+ findings only, nitpick-only = clean. Give
  reviewer agents EXPLICIT read-only-git instructions — a past reviewer
  stashed in-flight work and switched branches on the shared worktree.
- Unslop pass on every PR body. PR titles `[BRIEF-98] <prefix>: Title Case`.
- Code style: no nested ternaries (hard ban); unions via as-const map +
  ValueOf (SHOUT_CASE keys, kebab-case values); no `...(cond ? {x} : {})` —
  build the object and if-assign; module-level logger consts; split
  sub-components/utils/consts into co-located files at birth; comments only
  for non-obvious constraints, never ticket ids or provenance.
- NEVER run the eval harness — this stack must not touch the generation
  surface (prompt/schema/validators/adapter defaults). If a change drifts
  into it, stop and tell me instead.
- Never kill processes you didn't start; my dev stack owns port 3000 (vite
  will fall back to 3001 — that's fine).
- On any blocker: diagnose the root cause, don't retry the same failing
  action.

## Environment facts (verified recently — trust these)

- GitHub Actions CI is billing-dead: jobs fail in seconds with a payments
  message, merges aren't blocked, so LOCAL gates are the only gates. Per PR:
  package lint + test (coverage floors ride inside `pnpm test`),
  `pnpm check:catalog`, typecheck, and per-branch lint on the stack.
- `pnpm lint` on main is RED with ~28 pre-existing errors (mostly apps/web +
  worker generate.test:1541). Compare against main's error set; introduce
  nothing new, fix nothing pre-existing.
- BSD sed on macOS: no `\b`, use `[[:<:]]`/`[[:>:]]`.
- README.md is prettier-ignored — never `prettier --write` it.
- Run package scripts from the repo root (`pnpm -C <pkg>` from a subdirectory
  fails silently when piped). Don't chain `&&` after a grep'd test run — grep
  succeeds even when tests fail; read the summary before pushing.
- `git add <folder>` does not stage a sibling file's deletion — stage
  deletions explicitly. Before switching branches, park cross-PR files in the
  scratchpad; verify `git show --stat` after each commit (uncommitted edits
  riding a checkout has burned two sessions).
- Verify-skill seed recipe is stale in one spot: create the grant first via
  `grantAuth(db).createGrant({ghTokenCiphertext, ghRefreshTokenCiphertext,
  keyRef, refreshExpiresAt})`, then `sessions.create({..., grantId})`; the
  grant table is `github_grant`. Fetch `gh auth token` inside the seed script
  (execFileSync), not through shell env.
- apps/web pulls-route tests flake under full-suite load — rerun the file
  standalone before blaming a change. `pnpm -r test | tail` truncates; use
  --no-bail and read the full log.

## The work (summary — the plan doc is authoritative)

Stacked in order; PR 5 must land in the stack before PR 6 or e2e goes red:

1. Honest tenancy: nullable `installation_id` across tenantColumns;
   `pull_request` gains `owner_user_id` + `source`
   (`app-installation`/`url-box`), CHECK exactly-one-of installation/owner;
   partial unique for owner rows; owner-scoped ctx variant in the tenant
   helpers; audit carries source. Design-heavy — take it slow, TDD.
2. Worker viewer-token generation: job carries `grant_id`; lazy decrypt via
   the existing key provider; port the reviewer-octokit PrSource from
   `urlBriefEngine.server.ts`; move the `MERGEBRIEF_URL_BOX_TOKEN` PAT
   backstop into the worker; generate task unchanged downstream (spend cap,
   revisions, narrative apply automatically).
3. API door: `POST /api/generate` → upsert user-owned `pull_request` +
   enqueue (job_key dedupe, debounce like the App door), return PR coords;
   delete the signed-out `gh`-CLI path; add the owner-delete operation
   (private-write, cascades). New wire error codes follow the api recipe with
   i18n templates.
4. Web: DB-backed "your briefs" home list (owner = viewer) replacing Local
   Briefs; URL-box submit navigates to `/repos/$repoId/pulls/$prNumber` and
   polls the generation projection; fix anything on that route assuming an
   installation; delete affordance on owned briefs.
5. Ingest tool + e2e reseeding: read `.brief.json` + sidecars → DB rows via
   `pullRequests.upsert` + artifact store under explicit
   `--target installation:<id> | user:<gh-id>`; idempotent; convert
   playwright fixtures from `MERGEBRIEF_OUT_DIR` files to DB seeding; run the
   one-time ingest of my ~19 local briefs into my tenant. Note: web
   `parseBrief` requires `uncertainBetween` on every change group — ingest
   must not hand-craft bodies that omit it.
6. Delete the web file path: `/briefs/` routes incl. summary-preview, local
   readers/handlers/server fns, Local Briefs UI + queries, compose bind
   mounts, web-side `MERGEBRIEF_OUT_DIR` plumbing (CLI keeps its out dir),
   retired i18n keys, `.env.example` + docs sweep. Run knip.

LOC guardrails: ideal <500, ceiling ~1000 per PR — split triggers are named
in the plan (PR 1 migration lead-PR; PR 5b playwright rework).

Finish = stack published (each PR based on its parent), all local gates
green per branch, reviewer clean per PR, runtime verify passed (paste
URL signed-in → worker generates → repo route renders with session + submit),
then report the stack to me and stop.
