# BRIEF-213 — Reclassifications carry on "id present", not "id survived descent"

## Problem (verified in code)

`assignGroupIds` reserves only the immediately previous Brief's ids:

- `packages/worker/src/task/anchoring.ts:249` — `previousGroupIds: previousBrief.changeGroups.map((g) => g.id)`
- `packages/worker/src/task/anchoring.ts:448` — `reservedIds: [...carriedIds, ...plan.previousGroupIds]`
- `packages/brief-core/src/diff/descent.ts` — the mint counter skips only `reservedIds ∪ previous`

A group id retired two revisions ago is therefore re-mintable for an unrelated
group. Carry-over then hands the reviewer's override to it, because its test is
bare id presence:

- `packages/persistence/src/stores/carry-over.ts` — `reclassifications: previous.reclassifications.filter((row) => groups.has(row.changeGroupId))`

Read marks do not have this hole: they gate on `brief.carried_chunk_ids`,
intersected per hop by `carriedThroughChain` (`packages/persistence/src/stores/review-session.ts:326`).
Reclassifications have no equivalent.

`descent.ts`'s own `reservedIds` doc already asks for the fix: "pass every id the
PR's brief chain has ever used where available".

### Second door: the fresh path

When `anchorPlan === undefined` (fresh restart, model swap, or any anchoring
degradation) `generate.ts:818` writes the model's raw group ids with no descent
and no reservation. Those ids collide with historical ids by construction, so a
reclassification from an earlier session lands on an unrelated group at 100%
rate — the same bug through a wider door. Read marks are safe here only because
`carriedChunkIds` is empty on that path.

## Storage decision

**`brief.used_group_ids`** — JSON `string[]`, the union of every group id the PR's
Brief chain has used, mirroring `carried_chunk_ids` in the same table.

Rejected: querying the chain at generation time. Group ids live only inside
`brief.body` (`packages/persistence/src/schema/brief.ts` has no change-group
table) and bodies are multi-hundred-KB — the walk would load every prior body on
every generation. `store.briefs.get(prev)` is *already* called at
`generate.ts:725`, so reading the column costs nothing extra.

Rejected: a per-brief `descended_group_ids` set intersected through the chain
(the read-mark twin). Correct, but it patches the read side and leaves id
resurrection live for every other consumer of group ids.

## Git requirements

`git-eng` is **mandatory** for all git operations during implementation — no raw
git/gh outside it.

- Branch off `main`: `feature/BRIEF-213/reserve-chain-group-ids` (PR 1),
  `feature/BRIEF-213/restart-drops-reclassifications` (PR 2, stacked on PR 1).
- Commits: **chunked** — one per logical unit, listed per PR below.
- Pre-commit gate: dispatch `performance-reviewer` on `git diff --cached` before
  every commit. Findings at confidence >= 80 are fixed and re-staged before the
  commit lands.
- No `Co-Authored-By` trailers. No AI-attribution anywhere in commits or PR bodies.
- PR title: `[BRIEF-213] fix: <Change Description In Title Case>`.
- No PR template exists in this repo — use the default Overview / Changelog
  structure. No Images section (backend PRs).
- Idan merges. Reviewer agents never push to a branch they did not create.

## Mandatory skills

- **`tdd`** — the skipped-revision test is the point of the work; it is written
  first and must fail before the fix.
- **`typescript-eng`** — strict TS, no `any`, no bare `as`; Zod at the JSON column
  boundary.
- **`ponytail`** — laziest shape that holds (active session-wide).
- **`fable-reviewer`** — adversarial branch-diff review before each PR goes up.

## PR 1 — Reserve every group id the Brief chain has used

Est. ~350 LOC. Model: Fable 5 (Opus 5 high on quota fallback), high effort.
Invocation: sequential in the main thread — the layers depend on each other.

### Steps

1. **(TDD, red first)** `packages/brief-core/test/diff/descent.test.ts` — a
   retired id passed in `reservedIds` is never re-minted, even though it is
   absent from `previous`. Assert the minted id skips past it.
2. **(TDD, red first)** `packages/worker/test/anchoring.test.ts` — the
   multi-push shape end to end: group id minted at Brief 7, its files gone at
   Brief 8, an unrelated group at Brief 9/10 must NOT receive that id.
3. Schema: add `usedGroupIds: text("used_group_ids")` to
   `packages/persistence/src/schema/brief.ts` with a comment matching
   `carried_chunk_ids`' shape. Generate the migration via drizzle-kit
   (`packages/persistence/drizzle/0031_brief-used-group-ids.sql`). Nullable — no
   backfill; NULL is read as "chain unknown", which degrades to today's
   previous-brief-only reservation.
4. Store: `BriefWriteInput.usedGroupIds?: readonly string[]` in
   `packages/persistence/src/stores/artifact-store.ts`, serialized exactly as
   `carriedChunkIds` is (both the insert and the `onConflictDoUpdate` set).
   Parse on read with the existing `ChunkIdsSchema` shape — if it is reused
   verbatim, rename it to something id-neutral rather than minting a duplicate.
5. Worker read: `AnchorPlanArgs` gains `chainGroupIds?: readonly string[]`;
   `planAnchoredGeneration` folds it into `previousGroupIds` as a de-duplicated
   union (both the normal path at `anchoring.ts:249` and `allReLook` at :93).
   `assignGroupIds`' `reservedIds` then needs no change.
6. Worker write: `stitchBrief` returns `usedGroupIds` alongside
   `carriedChunkIds` — the incoming chain union ∪ the stitched brief's final
   group ids.
7. `generate.ts`: parse `prevRow.usedGroupIds` (NULL-tolerant, per the store
   schema) and pass it as `chainGroupIds` into `planAnchoredGeneration` (prevRow
   is already in hand at :725); pass `usedGroupIds` into `store.briefs.write`.
   Two seams that decide whether the chain ever heals:
   - **NULL heals forward**: when `prevRow.usedGroupIds` is NULL (row predates
     the column), seed the union from `previousBody.changeGroups` ids — already
     in hand — instead of the empty set. The written row then starts a valid
     chain even though its ancestors never had one.
   - **The fresh path writes it too**: `anchorPlan === undefined` (fresh
     restart, model swap, degradation) still unions the previous row's chain
     set (or the NULL fallback) with the fresh brief's raw ids. A first brief
     with no prevRow writes its own ids. The column is monotone from its first
     appearance on — no gaps.
8. Tests: `packages/persistence/test/artifact-store.test.ts` round-trip
   (write → read → NULL-tolerant parse); `packages/worker/test/generate.test.ts`
   asserts the column is written on both the anchored and fresh paths.
9. Gates: `pnpm test` (coverage floors ride inside it), `pnpm lint`,
   `pnpm typecheck`. `packages/worker` and `packages/persistence` are both
   touched — CI's changed-package filter covers both, but run the full local
   suite before pushing anyway.

### Commit chunks

1. `test:` failing descent + anchoring multi-push tests
2. `feat(persistence):` schema column + migration + store write/read
3. `fix(worker):` chain union into reservedIds, stitch emits usedGroupIds
4. `fix(worker):` generate.ts wiring on both anchored and fresh paths
5. `test:` store round-trip + generate wiring tests

### Not in scope for PR 1

No eval-harness run — nothing under `packages/brief-core/src/generation/` is
touched, so the generation surface has not moved.

## PR 2 — A restart in the chain drops reclassifications

Est. ~200 LOC. Model: Fable 5 (Opus 5 high on fallback), high effort.
Invocation: sequential, after PR 1 merges (stacked; realign with `git-eng`).

PR 1 stops id *resurrection*. It does not make id presence mean descent across a
brief that never descended anything. A `fresh-restart` or `none` brief in the
chain breaks the guarantee outright, so the reclassification must drop the way a
read mark already does. This is right even without an id collision: a
non-anchored brief re-derives its groups from scratch, so id equality there is
numbering coincidence, never identity.

### Steps

1. **(TDD, red first)** `packages/persistence/test/carry-over.test.ts` — a
   reclassification made before a `fresh-restart` brief does not carry, even
   when the id is present in the new Brief. Second case: a NULL `anchorState`
   (row predating the stamp) also drops.
2. `chainBriefs` (`review-session.ts:443`) selects `anchorState` into
   `ChainBrief`. The descent test mirrors `carriedThroughChain`'s bounds
   exactly: skip `headIndex <= fromHeadIndex` — the previous session's own
   brief's anchor state describes how it relates to ITS predecessor, which is
   outside the span being carried across. Only briefs strictly after it must
   all be `anchored` (`AnchorStates` imports from brief-core, as
   `carry-over.ts` already imports `brief-core/remap`).
3. `CarryOverContext` gains a field naming whether the chain descended end to
   end (e.g. `groupIdsDescended: boolean`); `evaluateCarryOver`'s
   reclassification filter returns `[]` when it is false. NULL anchor state
   counts as not-descended — every ambiguity biases to dropping, same stance
   as the disposition ladder. Document it in the same voice as the
   `carriedChunkIds` comment: an id that never descended is not the group the
   reviewer judged.
4. The read path and the materialization path both compute it — carry-over is
   evaluated twice (once on read, once inside the transaction against re-read
   rows); both call sites must pass it or the two disagree.
5. Gates: same as PR 1. `packages/api` consumes the session view — the local
   run must include it.

### Commit chunks

1. `test:` failing restart-in-chain carry test
2. `fix(persistence):` anchorState in the chain read
3. `fix(persistence):` reclassification gate in evaluateCarryOver + both call sites

## Open risk

`used_group_ids` grows with revision count. A 100-revision PR holds a few
hundred short ids — a few KB of JSON next to a multi-hundred-KB body. No
trimming, no TTL. If a pathological PR ever makes this hot, the shape to reach
for is a numeric high-water mark per PR rather than a set, since minting is a
monotone counter anyway.
