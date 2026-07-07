# Plan — BRIEF-24: Timeline navigation over the read API — browse older Brief revisions (post-M1 · close the loop)

> Status: **READY — grilled 2026-07-07, not started.** Ticket: Notion BRIEF-24.
> ADR: **0019** (model unchanged — this ticket grows a read contract only;
> no amendment needed, same posture as BRIEF-21). Grilled with Fable
> pre-cutoff; executable without Fable.

## What this delivers (product + technical context)

**Product:** a reviewer walks a DB-backed PR's Brief history — jump to any
older full-Brief revision ("what did the Brief say at head N-2?"), with the
Compare lenses (previous-Brief / your-last-review) offered wherever a valid
span exists for that head (ADR 0019: points are full Briefs; a Delta is a
lens, never a point). Also ships the **raw span diff** affordance (the
netted-out-change gap re-confirmed at the BRIEF-21 and BRIEF-23 smokes) and
the head-navigation half of BRIEF-25's outdated-thread jump.

**Technical:** two moves. (1) api: PR-meta grows `revisions[]` with
per-revision comparison availability — derived from listings the handler
already fetches plus batched span listings. (2) web: the local-path
timeline navigator ports over the read API; `?head=` selection; read-only
posture on historical heads; raw-span-diff toggle in the Changes Only pane.

## Locked decisions (grill 2026-07-07 — do not re-litigate)

1. **Revision list = grow PR-meta; no dedicated endpoint** (reverses the
   ticket's lean). The PR-meta handler already runs
   `briefs.listForPullRequest` per request (`reads.ts:165`, feeding both
   comparison derivations) and discards it; a dedicated endpoint would
   re-run the same gate + query and hand the FE a meta→list waterfall on
   BRIEF-19's designated single poll target. Shape:
   `revisions: [{ headSha, baseSha, headIndex, createdAt, comparisons }]`,
   ordered by `headIndex`, present when `briefAvailable`.
2. **`baseSha` is per-entry and load-bearing.** Base drifts across
   revisions (base-branch advance / retarget) and the brief GET is an exact
   `(pr, base, head)` lookup — deriving base from the top-level view 404s
   on drifted history. `createdAt` is the one projection addition to
   `BriefSpanRow` (`packages/persistence/src/artifact-store.ts:200`).
3. **Per-revision comparisons via batched span listings.** Marks / delta /
   narrative rows are keyed `(pr, baselineSha, headSha)`: one lean listing
   query per kind returns ALL spans for the PR; per-revision availability
   is an in-memory join — never N queries, regardless of point count.
   - `previousBrief` at `head[i]`: marks row exists for
     `(head[i-1] → head[i])` — the worker warmed exactly those spans at
     generation time, so history is already warm.
   - `lastReview` at `head[i]`: marks/delta row exists for
     `(checkpointSha → head[i])`. Row existence encodes direction (the
     worker only warms forward spans) — a checkpoint newer than the viewed
     head offers nothing, no special-casing.
   - Union semantics identical to BRIEF-21 (marks-only tier, unavailable
     reasons). The existing top-level `comparisons` (latest head) contract
     is byte-compatible — BRIEF-21 consumers unaffected; derivations
     (`derivePreviousBriefComparison` / `deriveLastReviewComparison`)
     parameterize by head with latest as the default.
4. **Baseline = current checkpoint only.** Prior-submitted-review baselines
   (ADR 0019 #4) need an immutable submitted-review history the
   `checkpoint` table doesn't hold — deferred, exactly as ADR 0019's
   consequences section anticipated.
5. **Route/UX:** selection via `?head=<sha>` on
   `/repos/$repoId/pulls/$prNumber`, validated against `revisions[]`;
   absent/unknown → degrade to latest with a polite note (never 404 a
   stale deep link). Composes with BRIEF-21's compare search params — one
   URL = one full view state; invalid head×compare combos degrade to
   compare-off with the disabled-tooltip pattern; browser back/forward
   walks the timeline.
6. **Historical points read-only (ADR 0019 #6):** non-latest head disables
   comment composition and submit with a reason tooltip (aria-disabled
   focusable, BRIEF-23 pattern) — the submit route pins `commit_id` to the
   viewed head; a historical submit would post against a stale commit.
   Drafts stay attached to the live session. Generation-status polling
   stays latest-bound; history never polls.
7. **Raw span diff affordance:** toggle inside the Changes Only pane,
   active when a compare is on — renders
   `GET /diff?base=<baseline>&head=<selected head>` through the existing
   pipeline (`parseUnifiedDiffPatch` shared module + DiffTable). FE-only
   (the diff proxy already serves arbitrary spans behind the gate); works
   for BOTH baselines; ephemeral toggle, not URL state.
8. **Outdated-thread jump (BRIEF-25 handoff):** thread anchor sha matched
   against `revisions[]`; hit → `?head=<anchor-sha>&thread=<databaseId>`
   (this ticket owns head navigation; BRIEF-25's conversation section owns
   reading `thread=`). Load-bearing edge: debounce means many comment
   anchors were never briefed heads — misses are common; affordance
   enables only on a hit, GitHub permalink remains the fallback, no
   nearest-revision guessing. Ships in whichever ticket lands second.

## Context for a fresh session (read before PR 1)

- **PR-meta handler:** `packages/api/src/routes/reads.ts:145` — the span
  listing is already fetched at `:165`; grow the response with
  `revisions[]` and thread the listing into both derivations.
- **Derivations:** `derivePreviousBriefComparison` /
  `deriveLastReviewComparison` (same file) — currently latest-head-only;
  parameterize by head. Batched span listings may need small store
  additions (list spans per PR for marks/deltas/narratives) — follow
  `listForPullRequest`'s lean-projection doc comment (never `body`).
- **FE timeline model to port:** `apps/web/src/features/brief/timeline.ts`
  (`BriefTimelinePoint {headSha, index, comparisons}` — already matches
  the wire shape) + `TimelineNavigator` component (picker + Prev/Next +
  capped stepper; ADR 0019 #7 a11y contract: focus-to-heading + polite
  announcement on selection).
- **Search params:** BRIEF-19 route decision — validated search params on
  `/repos/$repoId/pulls/$prNumber`; BRIEF-21's compare params are the
  in-repo precedent to mirror.
- **Read-only guard surfaces:** submit flow (`useReviewSubmit`,
  `ReceiptDrawer` aria-disabled pattern from BRIEF-23), comment composer
  entry points.
- **Test gotchas:** octokit throttling keeps MODULE-GLOBAL Bottleneck
  groups — never freeze/rewind `Date.now` in `packages/api` tests. CI is
  path-filtered per package — run dependents' suites locally on contract
  changes (PR-meta response shape is exactly such a contract).

## Mandates

Same as BRIEF-25 (`docs/plans/brief-25-conversation-display.md`): `git-eng`
for all git ops, stacked `feature/BRIEF-24/<slug>` branches, Idan merges,
no AI attribution; pre-commit `security-reviewer` + `performance-reviewer`
gate; LOC hard gate (ideal < 500, ceiling ~1000); `typescript-eng` + `tdd`
+ `verify` + `web-accessibility` (PR 2's navigator + disabled controls);
codex CLI review loop (GPT 5.5 High) per PR to zero new findings; CI green
before handoff; lint by exit code per branch.

## Subtasks → PRs

Dependency order PR 1 → PR 2 (stacked). Executable without Fable.

### PR 1 — `feature/BRIEF-24/pr-meta-revisions` (~350–550 LOC)

api + persistence (lean).

1. `BriefSpanRow` gains `createdAt`; store additions for batched span
   listings per PR (marks / deltas / narratives — lean projections).
2. PR-meta grows `revisions[]` (shape above); derivations parameterized by
   head; per-revision `comparisons` from the in-memory join; top-level
   latest `comparisons` contract unchanged.
3. Tests: ordering, baseSha drift fidelity (revision entries carry their
   own base), per-revision availability joins (previousBrief consecutive
   pairs; lastReview forward-span only; marks-only tier; unavailable
   reasons), tenancy posture unchanged, BRIEF-21 contract regression
   (latest comparisons byte-compatible).

### PR 2 — `feature/BRIEF-24/fe-timeline` (~450–700 LOC, stacked)

1. Port `buildBriefTimeline` + `TimelineNavigator` onto the DB path fed
   from PR-meta `revisions[]`; `?head=` param (validate, degrade-to-latest
   note); compare params compose; artifact fetches use the revision's own
   `(baseSha, headSha)`.
2. Read-only posture on historical heads (composer + submit disabled with
   reason; a11y per BRIEF-23 pattern); generation poll stays latest-bound.
3. Raw span diff toggle in the Changes Only pane (both baselines, existing
   diff pipeline, ephemeral state).
4. `thread=` param handled only if BRIEF-25's section already landed
   (otherwise no-op — the param contract is reserved either way).
5. Tests: route param validation + degrade path, navigator selection
   (focus + announcement), read-only guards, raw-diff toggle render,
   characterization harness green.

## PR budget sanity

| PR | Est. LOC | Gate |
|---|---|---|
| 1 pr-meta-revisions | 350–550 | store listings + derivations > 900 w/ tests → split store additions out |
| 2 fe-timeline | 450–700 | navigator + read-only + raw-diff > 900 → raw-diff toggle splits off |

## Verification (every PR)

```sh
pnpm -C packages/persistence typecheck && pnpm -C packages/persistence test  # PR 1
pnpm -C packages/api typecheck && pnpm -C packages/api test                  # PR 1
pnpm -C apps/web typecheck && pnpm -C apps/web test                          # PR 2 (+ api suite locally — contract change)
pnpm lint    # exit code is the judge; per stacked branch
```

End-to-end (`verify` skill + compose smoke): PR with ≥3 briefed heads →
navigator lists all revisions in order; selecting an older head renders
that revision's full Brief (fetched with ITS base — verify against a PR
with base drift if available); Compare offered only where spans exist
(marks-only tier renders highlights without narrative); `?head=` deep link
survives refresh; unknown head degrades to latest with the note; submit +
composer disabled on historical heads with reachable reasons; raw span
diff toggle shows the GitHub-style compare for the personal span
(including a change that netted out within the PR — the original gap).
