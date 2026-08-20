# BRIEF-213 — group ids: reserve the chain, drop across restarts

Ticket: [Reclassifications carry on "id present", not "id survived descent"](https://app.notion.com/p/3c25e9400eeb81f2b23af1b750066cd8)

Two stacked PRs. PR 1 stops retired group ids from being re-minted. PR 2 drops
reclassifications when the Brief chain contains a brief that never descended.
Both are needed: PR 1 kills resurrection, PR 2 kills the coincidence case where
a fresh brief's raw ids collide with history.

## Verified facts

Read these sites before editing; every step below assumes them.

- `packages/worker/src/task/anchoring.ts:249` and `:93` — `previousGroupIds`
  holds only the immediately previous Brief's ids.
- `packages/worker/src/task/anchoring.ts:448` — `reservedIds:
  [...carriedIds, ...plan.previousGroupIds]`; the mint counter in
  `packages/brief-core/src/diff/descent.ts` skips only this set, so an id
  retired two revisions back is re-mintable. `descent.ts`'s `reservedIds` doc
  already asks for the full chain.
- `packages/persistence/src/stores/carry-over.ts` (`evaluateCarryOver`) —
  reclassifications carry on bare membership: `groups.has(row.changeGroupId)`.
- `packages/worker/src/task/generate.ts:818` — fresh path (`anchorPlan ===
  undefined`: fresh restart, model swap, any anchoring degradation) writes the
  model's raw ids, no descent, no reservation. Collisions with historical ids
  are near-certain here.
- Prior art: read marks are immune because `carriedThroughChain`
  (`packages/persistence/src/stores/review-session.ts:326`) intersects
  `carried_chunk_ids` per hop; `chainBriefs` at `:443` is the chain query.
  Copy this pattern, do not invent a new one.
- Group ids exist only inside `brief.body` (no group table in
  `packages/persistence/src/schema/brief.ts`), and bodies are
  multi-hundred-KB. This is why the fix is a column, not a chain walk:
  `store.briefs.get(prev)` already runs at `generate.ts:725`, so a column read
  is free. A per-brief descended-set intersected per hop was also rejected —
  it patches only this reader and leaves resurrection live for every other
  consumer.

## Rules — all PRs

- All git operations go through the `git-eng` skill. Session decisions:
  chunked commits, `performance-reviewer` on the staged diff before every
  commit (fix ≥80-confidence findings before committing), no Co-Authored-By,
  no AI attribution. Idan merges.
- `tdd`: each PR opens with its named test, watched red, before any fix.
- `typescript-eng` and `ponytail` govern the code; `fable-reviewer` reviews
  the branch diff before each PR goes up.
- PR 2 stacks on PR 1's branch; realign after PR 1's squash-merge via
  `git-eng`.
- No eval harness — the generation surface is untouched.
- Done means: new tests green, `pnpm test` (floors ride inside), `pnpm lint`,
  `pnpm typecheck` all clean, run locally across every touched package plus
  `packages/api` (consumes the session view).

## PR 1 — reserve every id the chain has used

Branch `feature/BRIEF-213/reserve-chain-group-ids`. ~350 LOC.
Fable 5 high (Opus 5 high on quota fallback), sequential in the main thread.

New column `brief.used_group_ids`: JSON `string[]`, the union of every group
id the PR's Brief chain has used. Mirrors `carried_chunk_ids` in shape,
nullability, and comment voice. Monotone: each write unions the previous
row's set with the new brief's final ids.

1. Red test, `packages/brief-core/test/diff/descent.test.ts`: an id in
   `reservedIds` but absent from `previous` is never minted.
2. Red test, `packages/worker/test/anchoring.test.ts`: the ticket's multi-push
   shape — id minted at Brief 7, its files gone at Brief 8, an unrelated group
   at Brief 10 must not receive it.
3. Schema: add `usedGroupIds: text("used_group_ids")` to
   `packages/persistence/src/schema/brief.ts`; drizzle-kit migration
   `0031_brief-used-group-ids.sql`. Nullable, no backfill.
4. Store (`artifact-store.ts`): `BriefWriteInput.usedGroupIds?: readonly
   string[]`, serialized like `carriedChunkIds` in both the insert and the
   `onConflictDoUpdate` set. Parse reads with the existing JSON-`string[]`
   schema from `carry-over.ts`; if reused verbatim, rename it id-neutral
   instead of duplicating it.
5. Worker read: `AnchorPlanArgs.chainGroupIds?: readonly string[]`;
   `planAnchoredGeneration` unions it into `previousGroupIds` on both the
   normal path (`anchoring.ts:249`) and `allReLook` (`:93`). `reservedIds`
   at `:448` then needs no change.
6. Worker write: `stitchBrief` returns `usedGroupIds` — incoming chain set ∪
   the stitched brief's final ids.
7. `generate.ts` wiring, two seams that decide whether the chain heals:
   - NULL heals forward: `prevRow.usedGroupIds` NULL (pre-column row) →
     seed from `previousBody.changeGroups` ids, already in hand — never the
     empty set.
   - The fresh path writes too: `anchorPlan === undefined` still unions the
     previous row's set (or the NULL fallback) with the fresh brief's raw
     ids. First brief, no prevRow → its own ids. No gaps from first write on.
8. Tests: `artifact-store.test.ts` round-trip incl. NULL; `generate.test.ts`
   asserts the column on both the anchored and fresh paths.

Commits: (1) red tests, (2) schema + migration + store, (3) worker
reservation + stitch, (4) generate wiring, (5) round-trip + wiring tests.

## PR 2 — a restart in the chain drops reclassifications

Branch `feature/BRIEF-213/restart-drops-reclassifications`, on PR 1. ~200 LOC.
Same model, sequential, after PR 1.

PR 1 cannot make id presence mean descent across a brief that descended
nothing. A non-`anchored` brief re-derives groups from scratch, so id equality
there is numbering coincidence, never identity — the reclassification drops,
exactly as a read mark already does.

1. Red tests, `packages/persistence/test/carry-over.test.ts`: a
   reclassification made before a `fresh-restart` brief does not carry even
   though its id is present; a NULL `anchorState` (pre-stamp row) also drops.
2. `chainBriefs` (`review-session.ts:443`) selects `anchorState` into
   `ChainBrief`. Import `AnchorStates` from brief-core (`carry-over.ts`
   already imports `brief-core/remap`).
3. Bounds mirror `carriedThroughChain` exactly: skip `headIndex <=
   fromHeadIndex`. The previous session's own brief describes its relation to
   ITS predecessor — outside the carried span; including it wrongly drops
   carries whenever that session sat on a fresh-restart brief.
4. `CarryOverContext.groupIdsDescended: boolean`; `evaluateCarryOver` returns
   `[]` for reclassifications when false. NULL anchor state counts as
   not-descended — ambiguity biases to drop, the disposition ladder's stance.
   Comment in the `carriedChunkIds` voice: an id that never descended is not
   the group the reviewer judged.
5. Both evaluation sites pass it — preview and the materialization
   transaction (`review-session.ts:598` re-reads and re-evaluates); if only
   one does, read and write disagree.

Commits: (1) red tests, (2) anchorState in the chain read, (3) gate in
`evaluateCarryOver` + both call sites.

## Open risk

`used_group_ids` grows with revision count — a few KB of JSON on a
100-revision PR, beside a multi-hundred-KB body. If it ever goes hot, replace
the set with a per-PR numeric high-water mark; minting is a monotone counter.
