# Plan — BRIEF-21: Delta view over the read API — last-review comparison for DB Briefs (post-M1 · close the loop)

> Status: **DONE — PRs #45 + #46 merged 2026-07-07.** Ticket: Notion BRIEF-21.
> Timeline navigation split to BRIEF-24 (which also inherited the
> raw-span-diff affordance candidate from the smoke session — see the
> roadmap's 2026-07-07 entries). The optional `base_sha` fold-in shipped in
> PR #45. Smoke caveat that shaped follow-ups: `lastReview` stays absent in
> production until BRIEF-23 writes checkpoint rows.

## What this delivers (product + technical context)

**Product:** BRIEF-19 shipped the previous-brief comparison (the worker's own
baseline rule). This ticket ships the *reviewer-personal* comparison: "what
changed since MY last review". A reviewer whose submit recorded a checkpoint
opens a DB-backed Brief after a push and gets a Compare offer for the span
(their last-submitted head → current head), with the pre-warmed delta core
rendered where it exists — and an honest, tooltipped explanation where it
doesn't.

**Technical:** pure read-side; the worker already warms delta cores per
checkpoint SHA. Two moves. (1) api: a delta GET endpoint plus PR-meta growth —
`comparisons.lastReview` derived per-reviewer from the session's checkpoint
row, as a union that carries the unavailable-reason. (2) web: wire the
last-review comparison into the existing comparison/delta rendering, with
disabled-with-tooltip states for the degradation tiers.

## Locked decisions this plan implements (do not re-litigate)

- **Availability surface: PR-meta growth, no dedicated endpoint.**
  `comparisons.lastReview` joins `comparisons.previousBrief` (the slot
  `reads.ts` reserved). Derivation mirrors `derivePreviousBriefComparison`:
  requesting reviewer's `checkpoint` row → span (`lastSubmittedSha`, current
  head) → marks/delta row existence. PR-meta becomes per-reviewer; already
  `no-store`, so fine.
- **`lastReview` is a union** — available payload
  `{ marksId?, deltaAvailable, baselineSha, baselineIndex? }` OR
  `{ unavailable: <reason> }`, closed kebab-case vocab:
  `baseline-unavailable` (checkpoint exists, no marks, no pending/running
  delta generation — GC'd / rewritten history), `pending` (no marks yet but a
  delta-kind generation row for the baseline is non-terminal). No checkpoint
  row → field ABSENT (nothing to explain; reviewer never submitted).
- **Marks-only tier is an OFFER, not a failure.** Worker writes span marks
  BEFORE the LLM call and skips only the delta core on huge spans ("absence
  IS the signal" — no stub artifact). Marks row without a delta row → offer
  the comparison with mechanical highlights; the delta pane falls back to the
  full Brief with a tooltip ("change summary skipped — span too large").
- **Delta endpoint:** `GET /api/repos/:repoId/pulls/:prNumber/delta?baseline&head`
  behind the existing full per-repo gate + 60s positive authz cache; 404
  posture identical to the marks/narrative GETs; body served as stored
  (artifact JSON), `no-store`.
- **Identity plumbing already exists** — `AuthzVariables.session` is a
  `ReviewerSessionRow` carrying `reviewerId` (same branded type keying
  `checkpoint`); reads already do `c.get("session")`.
- **FE surface:** span via search params on `/repos/$repoId/pulls/$prNumber`
  (BRIEF-19 route decision); reuse the existing delta renderer + comparison
  rendering (local `.delta.json` path proves the components). Disabled
  Compare control with reason tooltip for the unavailable states.
- **Out of scope:** timeline navigation (BRIEF-24), per-reviewer delta
  overlays (M2 `delta_overlay` boundary), any write-side change.

## Context for a fresh session (read before PR 1)

- **Reserved slot:** `packages/api/src/routes/reads.ts:152` — PR-meta builds
  `comparisons` additively; `derivePreviousBriefComparison` (same file,
  ~line 326) is the derivation to mirror.
- **Local-path contract to match:** `apps/web/src/features/brief/
  brief.server.ts` `buildComparisonAvailability` (~line 253) already emits a
  `lastReview` shape `{ marksId, deltaId?, baselineSha, baselineIndex }` for
  the local path — keep the DB payload structurally compatible so
  `compareState.ts` / the FE types unify.
- **Schema:** `packages/persistence/src/schema/checkpoint.ts` (one row per
  reviewer×PR, `lastSubmittedSha` advances on submit only);
  `schema/delta.ts` (reviewer-agnostic, natural key
  installation×PR×baseline×head); `schema/comparison-marks.ts` (span lower
  bound is prevHead OR checkpoint SHA — D13); `schema/generation.ts`
  (`baseline_sha` null for brief, checkpoint SHA for delta — the `pending`
  discriminator).
- **Worker ordering (why the tiers exist):**
  `packages/worker/src/generate.ts` `warmDeltaCores` (~line 748) — span diff
  unavailable → skip everything (no marks); marks written before the LLM
  call; huge span → marks only, no delta artifact.
- **Checkpoint rows may not exist yet in real data** — BRIEF-23 (review
  submit) is what writes them. Tests seed rows directly via persistence;
  compose smoke may need a hand-inserted checkpoint row until BRIEF-23 lands.
- **FE compare surface today:** the local path's Compare controls live inside
  `TimelineNavigator` (needs the local timeline); the DB route got its own
  `DbCompareBar` over the shared `compareState` helpers (BRIEF-19 PR #41).
  PR 2 extends `DbCompareBar` — do NOT try to unify with TimelineNavigator
  (that unification is BRIEF-24's problem, when the DB timeline exists).
- **Test gotcha (octokit):** the throttling plugin keeps MODULE-GLOBAL
  Bottleneck groups — any test that freezes/rewinds `Date.now` poisons later
  GitHub-calling tests with phantom throttle waits. Use a forward-only clock
  offset; never fake timers or a restoring spy in `packages/api` tests.
- **Known gap this ticket may inherit:** PR-meta's `baseSha` is null whenever
  `briefAvailable` is false (BRIEF-19 follow-up, agreed 2026-07-06): the SHAs
  were never persisted on `pull_request`. Fix = column + migration (same
  shape as the `title` change in #32, ADR 0018 D5 note) + PR-meta returns the
  span regardless of brief existence. Slotted here as an OPTIONAL fold-in to
  PR 1 if budget allows (< ~150 LOC), else its own small PR — decide at the
  PR 1 LOC gate.
- **Runtime verification recipe** lives in `.claude/skills/verify/SKILL.md`
  (seed a session with a `gh` CLI token, drive the dev server). Caveat:
  `gh` tokens cannot call `/user/installations`, so list-endpoint live paths
  need a real OAuth session — irrelevant to this ticket's endpoints (per-repo
  gate only).
- **Workflow notes (from memory):** SSH push broken — push via the gh HTTPS
  helper; force-with-lease needs explicit `:sha` on explicit-URL pushes; lint
  judged by exit code per branch, never grep; enum vocabularies are
  CHECK-constrained (adding a DB-stored value needs code + migration in
  lockstep — the `unavailable` reason vocab lives only in the API response,
  NOT the DB, so no migration).

## Mandates

**Git — `git-eng` skill for ALL git operations** (branch, commit, push, PR):
- Start: `git checkout main && git pull`, then `feature/BRIEF-21/<slug>` per
  PR; PR 2 stacks on PR 1's branch (stacked-PR flow; Idan merges).
- No `Co-Authored-By`, no AI-attribution in commits or PR bodies.
- Chunked commits per logical unit within a PR (confirmed 2026-07-07).
- **Pre-commit review gate (confirmed 2026-07-07):** run `security-reviewer`
  AND `performance-reviewer` in parallel on staged changes before EVERY
  commit; findings ≥ 80 confidence → fix, re-stage, re-run until clean.
- **LOC ceiling is a hard gate:** measure `git diff --stat` against the base
  after every part; ideal < 500, ceiling ~1000; exceeded → split, don't
  rationalize.

**Specialist skills — mandatory, confirmed 2026-07-07:**
- `typescript-eng` — all parts (strict TS, no enum, `as const` + `ValueOf`,
  Result at boundaries, Zod, named exports, extensionless imports).
- `tdd` — api parts test-first against the PGlite + `app.request()` harness;
  FE derivation/state logic test-first in vitest.
- `verify` before committing each nontrivial part (drive the real flow, not
  just tests).
- `web-accessibility` — the disabled-control + tooltip surface (tooltip must
  be keyboard-reachable/focusable, not hover-only; `aria-disabled` +
  described-by, reduced motion untouched).

## Review loop — codex CLI (mandatory per PR, confirmed 2026-07-07)

After a PR is pushed and open, run an iterative review loop until codex has
no new findings:

1. **Review:** invoke the codex CLI with **GPT 5.5, reasoning effort High**
   on the PR; codex leaves INLINE comments on the PR (failure-scenario-based;
   the same quality bar as the BRIEF-3 subagent reviews — no nitpicks).
2. **Address:** the main session addresses EVERY comment — reply on the
   thread AND fix with a regression test (or reply with the reasoned
   pushback if the finding is wrong; never silently resolve).
   Upstream-first across the stack: fix PR 1, push, rebase PR 2
   (force-with-lease with explicit `:sha`), then fix PR 2.
3. **Iterate:** re-run codex on the updated diff. Loop back to step 2.
4. **Exit:** the loop ends only when a codex pass produces ZERO new
   findings. Then the PR waits for Idan to merge.

**Stack hygiene:** whenever a change lands anywhere in the chain (review fix,
fold-in, rebase of the base branch), every SUBSEQUENT PR in the stack rebases
onto its base branch immediately (force-with-lease with explicit `:sha`) —
no stacked PR is left pointing at a stale base.

**CI gate:** every PR's CI must be green before its review loop counts as
done — after every push (including rebases), check the run (`gh pr checks` /
`gh run watch`) and fix failures before proceeding. A red-CI PR is never
handed to Idan for merge.

Pre-commit gates (security/performance reviewers) do NOT replace this loop —
they run before commits; codex reviews the assembled PR.

## Subtasks → PRs

Dependency order: PR 1 → PR 2 (stacked). Sequential, main thread — PR 2
consumes PR 1's response contract; no parallelism worth the handoff cost.

### PR 1 — `feature/BRIEF-21/delta-read-api` (~450–650 LOC)

Tenancy-sensitive contract work. **Model: Fable, high effort, main thread.**

1. Persistence read boundaries (ctx-bound, under `forTenant`):
   `checkpoints.getForReviewer(pullRequestId, reviewerId)`,
   `deltas.getForSpan(pullRequestId, baselineSha, headSha)` (or EXISTS +
   body read, matching how marks/narrative reads are shaped),
   `generation.latestDeltaForBaseline(pullRequestId, baselineSha)` for the
   `pending` discriminator. Reuse existing boundaries where they already fit —
   check before adding.
2. `GET .../delta?baseline&head`: full gate; query Zod-validated (SHA shape,
   reject `:` like the diff route); artifact body as stored; 404 collapse
   identical to marks/narrative; `no-store`.
3. PR-meta: derive `lastReview` per the locked union. Skip derivation
   entirely when `briefAvailable` is false or headSha null (same guard as
   previousBrief). Reason precedence: marks exist → available (with
   `deltaAvailable` flag); no marks + non-terminal delta generation →
   `pending`; no marks otherwise → `baseline-unavailable`.
4. Response typing: closed reason vocab as `as const` map + `ValueOf`
   (API-layer only, no DB migration).

Tests first (tdd): checkpoint absent → field absent; own-checkpoint scoping
(reviewer A's checkpoint never drives reviewer B's PR-meta); marks+delta →
available; marks-only → `deltaAvailable: false`; no-marks × {pending, absent}
generation → reason split; tenancy (cross-installation checkpoint/delta rows
never leak); delta GET 404 posture + authz-cache interplay.

### PR 2 — `feature/BRIEF-21/fe-last-review-compare` (~450–700 LOC, stacked on PR 1)

**Model: Sonnet, high effort, main thread — Fable reviews the tier/state
mapping before commit.**

1. FE types + `compareState`: extend the comparison state to carry the DB
   `lastReview` union; unify with the local-path shape where they meet.
2. queryOptions for the delta GET over `apiFetch`; client-side on-demand
   (no SSR prefetch — same posture as marks/narrative in BRIEF-19 4.1).
3. Compare offer wiring: available → offer last-review comparison alongside
   previousBrief (span via search params); marks-only tier → comparison
   renders mechanical highlights, delta pane shows full Brief + "span too
   large" tooltip; `unavailable` reasons → disabled Compare control with
   reason tooltip (`pending`: "delta still generating";
   `baseline-unavailable`: "history rewritten since your last review");
   field absent → no control at all.
4. Accessibility: tooltip pattern per `web-accessibility` (focusable
   trigger, `aria-describedby`, ESC dismiss); disabled control stays
   focusable (`aria-disabled`) so the tooltip is reachable.

Tests: state mapping unit tests over the union (all five tiers), route test
for the offer wiring, characterization harness stays green.

## PR budget sanity

| PR | Est. LOC | Gate |
|---|---|---|
| 1 delta-read-api | 450–650 | if boundaries + endpoint + PR-meta > 900 with tests, split boundaries+endpoint / PR-meta growth |
| 2 fe-last-review-compare | 450–700 | tooltip/disabled-state surface splits off if > 900 |

## Verification (every PR)

```sh
pnpm -C packages/persistence typecheck && pnpm -C packages/persistence test   # PR 1
pnpm -C packages/api typecheck && pnpm -C packages/api test                   # PR 1
pnpm -C apps/web typecheck && pnpm -C apps/web test                           # PR 2 (characterization included)
pnpm lint    # exit code is the judge; run per stacked branch
```

End-to-end (`verify` skill): compose up, seed a checkpoint row for the
signed-in reviewer (BRIEF-23 not landed yet), push to the test PR, wait for
delta warmup, open the Brief → last-review Compare offered → delta renders;
delete the delta row (keep marks) → marks-only tier; delete marks →
disabled control + reason tooltip.
