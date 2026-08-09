# Plan — BRIEF-23: Review submit — post the review to GitHub with the reviewer's token (post-M1 · close the loop)

> Status: **DONE — shipped 2026-07-07** (PRs #47–#50 merged, smoke passed;
> plan's 3 PRs became 4 at the LOC gate). Ticket: Notion BRIEF-23.
> The accepted sessionStorage residual (PR #50 thread) is closed by design
> in BRIEF-25 — see ADR 0027 / `brief-25-conversation-display.md`.
> Comments-display (others' review comments in the Brief + follow-up replies)
> split to its own ticket at the grill:
> https://app.notion.com/p/3965e9400eeb81209c02dabf067d0984

## What this delivers (product + technical context)

**Product:** closes the reviewer's loop. Today the Mind-Map session
(dispositions, review comments, outcome) is local-only — nothing ships it.
After this ticket, a reviewer finishes a DB-backed Brief, hits Submit, and a
real GitHub review appears on the PR — one formal, grouped review **authored
by the reviewer, not the App** (ADR 0016 #4) — with their verdict and anchored
comments. Submitting also (via the webhook echo) records the reviewer's
`checkpoint`, which is the baseline that powers BRIEF-21's last-review
comparison: this ticket is what makes those baselines exist in real data.

**Technical:** three moves. (1) github: a `createPullRequestReview` primitive
plus parser growth on the review webhook (`review.commit_id`,
`review.user.type`, `review.submitted_at`). (2) persistence: monotonic
checkpoint upsert + a new `submit` audit action (CHECK migration). (3) api:
the webhook handler grows the checkpoint write; a new gated
`POST .../review` route posts the review with the viewer's token; web wires
Submit on the DB path.

## Locked decisions (grill 2026-07-07 — do not re-litigate)

1. **Checkpoint writer = webhook only.** The submit route posts the GitHub
   review + emits audit; the `pull_request_review.submitted` webhook —
   including the echo of our own submit — writes the checkpoint. One code
   path covers in-app AND native github.com reviews. ADR 0018 D7's letter
   ("webhook-driven, never an in-app write") stays literally true — no ADR
   amendment needed. No dual write: self-host serves the route and receives
   webhooks in the same process, so the missed-echo window is ~nil, and
   nothing reads the checkpoint synchronously.
2. **Checkpoint SHA = `review.commit_id`, never `pull_request.head.sha`**
   (head at delivery time is wrong when pushes landed mid-review). The route
   passes `commit_id` = the viewed head on POST; the parser gains the field
   and the webhook records it.
3. **Drift posture:** pinning `commit_id` makes normal-push and most
   force-push drift post fine — GitHub retains force-pushed-away commits and
   marks the comments "outdated" (its native behavior, aligned for free).
   Genuine 422 on an unknown SHA → **fail closed**: sanitized error, FE copy
   "PR was rewritten since you read it — reload". No auto-retry at a
   different SHA. Drafts survive reload (session store persists to
   sessionStorage per brief); the force-push→new-briefId orphaned-key edge is
   accepted (BRIEF-24 territory).
4. **Checkpoint advance policy:** all three submitted states (`approved` /
   `changes_requested` / `commented`) advance; author self-reviews advance
   their own checkpoint; **bot-authored reviews (`review.user.type ===
   "Bot"`) are skipped** — bot checkpoints would trigger delta-core pre-warms
   (LLM spend) for baselines no human ever opens. No empty-body drive-by
   heuristic: a drive-by commenter did see that head.
5. **Outcome mapping 1:1, no inference:** `ReviewOutcome` ("comment" /
   "approve" / "request-changes" — already first-class in the session store,
   default "comment") maps directly to COMMENT / APPROVE / REQUEST_CHANGES.
   Never derived from dispositions. FE disables Approve/Request-changes for
   the PR author (GitHub 422s them); neutral COMMENT requires ≥1 comment or
   nonempty body.
6. **Anchoring:** `CommentAnchor` (file, side old|new, startLine, endLine)
   maps 1:1 to GitHub's `path` / `side LEFT|RIGHT` / `line` / `start_line`.
   Anchors are built from the same diff GitHub validates against (commit_id =
   viewed head), so failures are edge-only. GitHub's create-review is
   **atomic** (one invalid comment 422s the whole review, failing index not
   reliably parseable) → on anchoring 422 (commit valid), **one degradation
   retry**: all comments folded into the review body as quoted blocks
   (`file:line` + the anchor's `selectedText` + body), auto (no confirm
   prompt), receipt notes the degradation. Nothing silently dropped.
7. **Re-submit = allow as new review** (GitHub permits multiple reviews per
   reviewer per commit; add-more-comments is a legit flow). Double-post guard
   is **FE-only** (pending-state disable); no server-side in-flight lock and
   no dedup — GitHub review creation has no idempotency key, and a
   checkpoint-based check races the webhook. The ticket's "enforced
   server-side" is amended to: semantics decided, enforcement = FE guard.
8. **Webhook residuals:** checkpoint write ordered before the generation
   enqueue (no new job — the existing review-event `triggerGeneration` +
   worker state-derivation warms any real span); unknown-PR skip stays and
   extends to the checkpoint (FK needs the parent; phantom-row reasoning
   unchanged); redeliveries safe via idempotent upsert; **monotonic guard**
   on `upsertOnSubmit` — `DO UPDATE ... WHERE checkpoint.submitted_at <=
   excluded.submitted_at` (contract becomes newest-submission-wins), using
   GitHub's `submitted_at`, closing out-of-order delivery regression.
9. **Audit:** route emits an audit row on successful post; `AuditAction`
   gains `SUBMIT: "submit"` — CHECK-constrained, so code + migration in
   lockstep. Metadata stays within the numeric-only allowlist (D9).

## Context for a fresh session (read before PR 1)

- **Webhook handler:** `packages/api/src/routes/webhook.ts:97`
  (`handlePullRequestReview`) — currently only re-queues generation for known
  PRs; grows the checkpoint write (bot filter → upsert → existing enqueue).
- **Parser:** `packages/github/src/events.ts:208`
  (`pullRequestReviewEventSchema`) + `:304` (`parsePullRequestReview`) —
  filters to `submitted` at `:421`; add `review.commit_id`,
  `review.user.type`, `review.submitted_at` to schema + parsed event.
- **Persistence boundary:** `packages/persistence/src/tenant.ts:407`
  (`checkpoints.upsertOnSubmit`) — exists, idempotent, tenant-verified; add
  the monotonic `WHERE`. Audit vocab:
  `packages/persistence/src/types.ts:106` (`AuditAction`) + the CHECK
  constraint lockstep rule in `packages/persistence/AGENTS.md` (migrations
  via `drizzle-kit generate` only, append-only).
- **Viewer-token pattern to copy:** `packages/api/src/routes/pulls.ts:64-104`
  — lazy `decryptToken` → `createUserOctokit` → refresh-once-on-401 via the
  serialized orchestrator (`authz.ts` / `refreshSessionToken`). The submit
  route reuses it verbatim; target repo by the gate's GitHub-verified
  `repoFullName`, never the stored slug.
- **FE shapes already in place:**
  `apps/web/src/features/review/comments.ts:5` (`CommentAnchor` — carries
  `selectedText`, used in the body-fallback quotes);
  `features/review/state.ts:8` (`ReviewOutcome`, store default "comment");
  `features/review/session/snapshot.ts` (sessionStorage persistence, per
  briefId); `PreSubmitModal` / `ReceiptDrawer` components hold the submit
  assembly.
- **FE→API contract decision:** the FE maps anchors to GitHub shape
  client-side and sends `{ outcome, commitId, body?, comments[] {path, line,
  side, startLine?} }`; the route Zod-validates shape only (SHA-shaped
  commitId, side enum, int lines, length/count caps) — the server needs no
  chunk knowledge.
- **Author guard dependency:** disabling Approve/Request-changes for the PR
  author needs viewer==author knowledge in the FE. Check whether PR-meta
  carries the author; if not, EITHER fold a trivial author field into
  PR-meta OR map GitHub's 422 to a clean error (acceptable M1 fallback) —
  decide at PR 3's LOC gate, don't expand silently.
- **GitHub API facts baked into the design (verify #1 in smoke):**
  create-review is atomic; `commit_id` of a force-pushed-away commit
  normally still posts (comments render "outdated"); multiple submitted
  reviews per reviewer per commit are allowed; APPROVE/REQUEST_CHANGES on
  your own PR 422s.
- **Dev/smoke caveat:** checkpoints only appear when webhook deliveries
  reach the instance — local submit testing needs the forwarding channel
  (same infra generation already needs). A submit smoke without it silently
  writes no checkpoint.
- **Test gotcha (octokit):** the throttling plugin keeps MODULE-GLOBAL
  Bottleneck groups — never freeze/rewind `Date.now` in `packages/api`
  tests; forward-only clock offsets only.
- **Workflow notes (from memory):** SSH push broken — push via the gh HTTPS
  helper; force-with-lease needs explicit `:sha` on explicit-URL pushes;
  lint judged by exit code per branch, never grep.

## Mandates

**Git — `git-eng` skill for ALL git operations** (branch, commit, push, PR):
- Start: `git checkout main && git pull`, then `feature/BRIEF-23/<slug>` per
  PR; PRs stack (PR 2 on PR 1's branch, PR 3 on PR 2's); Idan merges.
- No `Co-Authored-By`, no AI-attribution in commits or PR bodies.
- Chunked commits per logical unit within a PR.
- **Pre-commit review gate:** run `security-reviewer` AND
  `performance-reviewer` in parallel on staged changes before EVERY commit;
  findings ≥ 80 confidence → fix, re-stage, re-run until clean.
- **LOC ceiling is a hard gate:** measure `git diff --stat` against the base
  after every part; ideal < 500, ceiling ~1000; exceeded → split, don't
  rationalize.

**Specialist skills — mandatory, confirmed 2026-07-07:**
- `typescript-eng` — all parts (strict TS, no enum, `as const` + `ValueOf`,
  Result at boundaries, Zod, named exports, extensionless imports).
- `tdd` — github/persistence/api parts test-first against the existing
  harnesses (PGlite + `app.request()`); FE mapping/state logic test-first in
  vitest.
- `verify` before committing each nontrivial part (drive the real flow, not
  just tests) — submit needs the webhook forwarding caveat above.
- `web-accessibility` — PR 3's surface: pending/disabled Submit states and
  the author-guard disabled controls (focusable `aria-disabled` + reachable
  reason tooltip, not hover-only), error copy announced properly.

## Review loop — codex CLI (mandatory per PR)

After a PR is pushed and open, run an iterative review loop until codex has
no new findings:

1. **Review:** invoke the codex CLI with **GPT 5.5, reasoning effort High**
   on the PR; codex leaves INLINE comments (failure-scenario-based; no
   nitpicks).
2. **Address:** address EVERY comment — reply on the thread AND fix with a
   regression test (or reply with reasoned pushback; never silently
   resolve). Upstream-first across the stack: fix PR 1, push, rebase PR 2 and
   PR 3 (force-with-lease with explicit `:sha`), then continue downstream.
3. **Iterate:** re-run codex on the updated diff; loop to step 2.
4. **Exit:** only when a codex pass produces ZERO new findings. Then the PR
   waits for Idan to merge.

**Stack hygiene:** whenever a change lands anywhere in the chain, every
subsequent PR rebases onto its base immediately — no stacked PR points at a
stale base.

**CI gate:** every PR's CI must be green before its review loop counts as
done (`gh pr checks` / `gh run watch` after every push, including rebases).
A red-CI PR is never handed to Idan for merge.

Pre-commit gates do NOT replace this loop — they run before commits; codex
reviews the assembled PR.

## Subtasks → PRs

Dependency order: PR 1 → PR 2 → PR 3 (stacked). Sequential, main thread,
**Fable high effort throughout** (confirmed 2026-07-07) — PR 2 consumes
PR 1's primitives, PR 3 consumes PR 2's route contract; no parallelism worth
the handoff cost.

### PR 1 — `feature/BRIEF-23/submit-foundations` (~350–550 LOC)

github + persistence primitives; no route or FE changes.

1. Parser growth: `pullRequestReviewEventSchema` + `parsePullRequestReview`
   gain `review.commit_id` (SHA), `review.user.type`, `review.submitted_at`;
   `ParsedPullRequestReviewEvent` carries them typed.
2. `createPullRequestReview` primitive:
   `POST /repos/{owner}/{repo}/pulls/{n}/reviews` with `commit_id`, `event`,
   `body`, `comments[] {path, line, side, start_line?, start_side?}`;
   sanitized `Result` via `mapRequestError`; error taxonomy distinguishes
   the 422 classes the route needs (unknown commit vs invalid comment —
   as far as GitHub's response allows).
3. Persistence: monotonic guard on `upsertOnSubmit`
   (`WHERE submitted_at <= excluded.submitted_at`; contract doc updated to
   newest-submission-wins); `AuditAction.SUBMIT` + CHECK migration
   (drizzle-kit generate, lockstep).

Tests first (tdd): parser fixtures for the new fields (incl. a Bot-authored
review payload); primitive request-shape + error sanitization; upsert
monotonicity (older `submitted_at` never regresses the row); migration
round-trip via the PGlite harness.

### PR 2 — `feature/BRIEF-23/submit-route-and-checkpoint` (~450–700 LOC, stacked on PR 1)

The api layer: webhook growth + the submit route.

1. Webhook: `handlePullRequestReview` writes the checkpoint (skip
   `user.type === "Bot"`; SHA = `commit_id`; `submittedAt` = payload
   `submitted_at`) BEFORE the existing `triggerGeneration` enqueue;
   unknown-PR skip unchanged.
2. Route `POST /api/repos/:repoId/pulls/:prNumber/review`: full per-repo
   gate; Zod body (outcome + commitId + body? + comments[], with length and
   count caps); viewer token via the pulls.ts lazy-decrypt +
   refresh-once pattern; `commit_id` passthrough; on anchoring 422 → one
   degradation retry with comments folded into the body (quoted
   `file:line` + selectedText); on unknown-commit 422 → sanitized fail-closed
   response; audit row (`submit`) on success; posture (401/404 collapse,
   no-store, no upstream text) identical to the other gated routes.
3. Response contract for the FE: created review id + a
   `commentsDegraded: boolean` flag (drives the receipt note).

Tests first (tdd): integration with stubbed GitHub — payload shape (grouped
formal review, commit_id pinned), refresh-once mid-submit, degradation retry
path, fail-closed path, checkpoint written by the WEBHOOK not the route
(route emits audit only), bot review skips checkpoint, monotonic out-of-order
webhook pair, tenancy (cross-installation posture), double-submit produces
two reviews (documented-allowed), unknown-PR review skips cleanly.

### PR 3 — `feature/BRIEF-23/fe-submit-flow` (~450–700 LOC, stacked on PR 2)

1. Submit mutation on the DB path over `apiFetch` (local file path stays
   demo — no GitHub identity there): anchor→GitHub mapping (side old→LEFT /
   new→RIGHT, multi-line via startLine), outcome→event map, commitId = the
   Brief's viewed head.
2. Guards: pending-state disable (double-post), author-only-COMMENT
   (resolve the author-knowledge dependency per the context note — fold or
   fallback, decided at the LOC gate), neutral-COMMENT-needs-content.
3. Error + receipt surfaces: fail-closed copy ("PR was rewritten since you
   read it — reload"), degraded-anchoring note on the receipt
   (`commentsDegraded`), submitted state reflected in the session
   (comments flip `status: "submitted"`).
4. Accessibility per `web-accessibility`: disabled controls stay focusable
   with reachable reason tooltips; pending/error states announced.

Tests: mapping unit tests (anchor→GitHub incl. multi-line + old-side;
outcome map), submit-flow test over the DB route (success, fail-closed,
degraded), characterization harness stays green.

## PR budget sanity

| PR | Est. LOC | Gate |
|---|---|---|
| 1 submit-foundations | 350–550 | if primitive + parser + persistence > 900 with tests, split persistence bits out |
| 2 submit-route-and-checkpoint | 450–700 | if route + webhook > 900, split webhook checkpoint write into its own small PR |
| 3 fe-submit-flow | 450–700 | error/receipt surface splits off if > 900 |

## Verification (every PR)

```sh
pnpm -C packages/github typecheck && pnpm -C packages/github test        # PR 1
pnpm -C packages/persistence typecheck && pnpm -C packages/persistence test  # PR 1
pnpm -C packages/api typecheck && pnpm -C packages/api test              # PR 2
pnpm -C apps/web typecheck && pnpm -C apps/web test                      # PR 3 (characterization included)
pnpm lint    # exit code is the judge; run per stacked branch
```

End-to-end (`verify` skill + compose smoke, webhook forwarding up): submit
from a DB-backed Brief on the test PR → one formal grouped review appears on
GitHub under the reviewer's account with anchored comments → checkpoint row
appears (webhook echo) with `lastSubmittedSha` = viewed head → BRIEF-21's
`comparisons.lastReview` turns real on the next push. Verify the
dangling-commit_id assumption once: push between view and submit, confirm
the review still posts with "outdated" comments. Bot filter: trigger a bot
review (or replay a Bot fixture) and confirm no checkpoint row.
