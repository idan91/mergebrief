# BRIEF-40 — Grant entity: token-refresh divergence fix

Ticket: [Token-refresh divergence: CLI token strands after browser-session refresh](https://app.notion.com/p/39c5e9400eeb8147b2aac9ead4765042) (BRIEF-40).
Research: `docs/dev/brief-40-github-token-grant-research.md`. Design locked in ADR 0016 #4
(amended 2026-07-23) + ADR 0018 D15 (commit `449f9178`). Follow-up already filed:
"Grant revocation hygiene" (board, Later) — inbound `github_app_authorization` webhook +
outbound per-token DELETE are OUT of this plan's scope.

## Problem

Mint copies the session's envelope-encrypted GitHub pair into the `api_token` row verbatim
(`packages/api/src/routes/tokens.ts:143-144`). GitHub refresh tokens are single-use, so the
session and the token race each other's rotation; whichever refreshes first strands the
other. In practice the browser wins and the CLI token dies silently — the unattended-agent
use case breaks over time.

## Locked decisions (grill, 2026-07-23)

1. **First-class grant entity** (`github_grant`, ADR 0018 D15): the ONE holder of the
   encrypted pair (`gh_token_ciphertext`, `gh_refresh_token_ciphertext`, `key_ref`,
   `refresh_expires_at`). `reviewer_session` + `api_token` drop those columns, gain
   `grant_id` FK (not null). Mint links, never copies. Divergence unrepresentable.
2. **Refresh** = the existing lazy serialized CAS, re-anchored from the session/token row to
   the grant row; both channels converge on one rotation path. Session `expires_at` keeps
   its semantics, maintained from grant rotation; token expiry stays mint-chosen.
3. **Lifecycle:** grant dies with its last referent, same transaction (logout/sweep/revoke
   paths). Per-channel failure postures unchanged: cookie refresh-failure deletes the
   session; token rows are NEVER auto-deleted (dead grant may linger behind a dead token —
   inert). No GitHub-side revocation calls.
4. **Tenancy:** `github_grant` is NOT tenant-scoped (third D2b exception after `audit_log`,
   `user_settings`) — credential belongs to the GitHub user; installation binding stays on
   referencing rows. Type-level containment tests treat it like `audit`/`userSettings`.
5. **Migration backfill:** dedup by EXACT ciphertext match (verbatim mint-copy ⇒
   not-yet-diverged token matches its source session byte-for-byte → shares its grant);
   unmatched rows get their own grant. No data loss; live tokens keep working.
6. Rejected: device-flow own-grant (undocumented coexistence, manifest can't enable device
   flow, revocation blindness) and copy+cross-patch fan-out (missed-row hazard). Device flow
   stays parked as an onboarding revisit.

## Invariants (write these first; tests pin them)

- At most ONE physical copy of any GitHub pair exists post-migration and forever after.
- Every refresh path (cookie, bearer) rotates via the grant-row CAS; no code path writes
  ciphertext to `reviewer_session`/`api_token` (columns are gone — compile-time enforced).
- Concurrent refreshes across BOTH channels of one grant produce exactly one GitHub
  exchange (CAS short-circuit returns the stored fresh token to the loser).
- Deleting the last referent deletes the grant in the same transaction; deleting a non-last
  referent leaves it. No orphan grants after any logout/sweep/revoke sequence.
- Cookie refresh-failure still deletes only the session row; bearer failure deletes nothing.
- Error messages/logs never carry token material (repo standard).

## Git flow (git-eng, user-confirmed)

git-eng mandatory for ALL git operations. Chunked commits per logical unit. Stacked PRs,
ready-for-review: PR 1 base=`main`, PR 2 base=PR 1 branch; Idan merges (squash) — after each
merge, retarget/rebase the stack per the squash-stack recipe (`git rebase --onto`, never
plain-pull a just-rebased branch). No Co-Authored-By trailers, no AI attribution in PRs.
Gates (user-confirmed): **security-reviewer** on staged changes before each commit chunk
that touches auth/crypto/migration; **fable-reviewer** on the full branch diff before each
PR goes up. Findings ≥80 confidence: fix, re-stage, re-run until clean.

## Mandated skills (user-confirmed)

- `typescript-eng` — strict TS, no `enum`/`any`/bare `as`, named exports, extensionless
  imports (repo standard).

## PR breakdown

### PR 1 — persistence: `github_grant` schema, migration, grant-anchored auth seams

Branch: `feature/BRIEF-40/persistence-grant-entity`, base `main`.
Estimate ~700–900 LOC incl. tests — under ceiling, no split; re-measure diff-stat after
each part and split if it blows past ~1000.

1. `src/schema/github-grant.ts` (new) + `reviewer-session.ts`/`api-token.ts` column swap
   (`grantId` FK, drop ciphertext/keyRef columns); `schema/index.ts` export.
2. Migration `drizzle/0013_github-grant.sql`: create table; backfill — one grant per
   DISTINCT `(gh_token_ciphertext, gh_refresh_token_ciphertext, key_ref)` across both
   tables, wire FKs, then drop old columns. `expires_at`→`refresh_expires_at` seeding:
   sessions carry refresh expiry today; token rows may be older — take the max per group,
   fallback now()+6mo for orphan no-expiry tokens (bounded by GitHub anyway).
3. `src/auth/grant.ts` (new seam): `resolveGrant`, `refreshGrant` (CAS re-anchor of the
   current per-row `SELECT … FOR UPDATE` shape), `deleteIfOrphaned(tx, grantId)`.
4. `session.ts`/`token.ts` rework: resolve joins grant; mint takes `grantId` instead of
   ciphertext args; session delete / token hard-delete paths call `deleteIfOrphaned` in-tx.
5. Tests (PGlite): backfill dedup (shared → one grant; diverged → two), race matrix on
   `refreshGrant` (two concurrent per channel + cross-channel), last-referent lifecycle,
   containment test update (grant excluded from `forTenant` like `userSettings`).

Model/effort/invocation: Fable, high effort, main thread (design-heavy CAS + migration).

### PR 2 — api: refresh orchestrator + mint rewiring

Branch: `feature/BRIEF-40/api-grant-rewire`, base = PR 1 branch.
Estimate ~400–600 LOC incl. tests.

1. `routes/auth.ts`: `ViewerPrincipal` drops ciphertext fields, carries `grantId`;
   `rotateGitHubTokens` + both channel refreshers collapse onto `refreshGrant`; cookie
   failure path keeps delete-session, bearer keeps never-delete (postures pinned by tests).
2. `routes/tokens.ts` mint: link `currentSession.grantId` (copy lines die).
3. Logout keeps local-only semantics + orphan cleanup via persistence seam.
4. Tests: channel race matrix through `app.request()`, refresh-failure postures, mint→link
   assertion (no ciphertext duplication anywhere — grep-level test on principal shape is
   compile-time already; assert row counts).

Model/effort/invocation: Fable, medium effort, main thread, sequential after PR 1 (depends
on its seams; same session carries context).

## Verification

- Per PR: `pnpm -C packages/<pkg> typecheck && test`, repo-root `pnpm lint` (judge by exit
  code), per-branch lint on the stack.
- CI is path-filtered: PR 2 changes api only — run persistence suite locally anyway
  (contract-consumer rule, CLAUDE.md).
- After PR 2: `/verify` runtime pass — login (fresh grant row), mint token, force-expire
  access token, hit API via BOTH channels concurrently, confirm single rotation + both
  channels live; logout session → grant survives (token refs it); revoke token → grant
  gone.
- Not a generation-surface change — NO eval harness run needed.

## Risks / notes

- Hottest auth path — regression risk is auth outage; the race matrix is the gate, run it
  under real concurrency (PGlite serializes some interleavings; add an advisory-lock test
  against real Postgres in `/verify` if PGlite can't express the race).
- Migration drops columns — destructive step last in the SQL file, after backfill verified
  by the same migration's own integrity check (`SELECT count(*) WHERE grant_id IS NULL` = 0
  guard before drop).
- Existing sessions/tokens whose pairs already diverged: backfill gives them separate
  grants; the stranded one keeps 401ing exactly as today — expected, not a migration bug.
- Squash-merge stack: after PR 1 merges, `git rebase --onto main <old-base> <pr2-branch>`.
