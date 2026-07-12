# BRIEF-27 — Per-chunk selectors for commentsByChunk (stop memo-busting ChunkCard)

Ticket: https://app.notion.com/p/3965e9400eeb8171ad99ebe6809e5f3e

## Problem

`BriefPage`'s `commentsByChunk` useMemo (deps `[reviewComments]`) allocates a
fresh array for EVERY chunk on any comment save / edit / delete / toggle.
Those arrays flow through `StoryView` into the memoized `ChunkCard` as the
`comments` prop, so every open card — including its `DiffTable` subtree —
re-renders on each comment interaction anywhere on the page. `React.memo`
on ChunkCard is decorative for this prop path. Additionally,
`existingReviewCommentCount` (= `reviewComments.length`) is threaded
BriefPage → StoryView → ChunkCard → DiffTable → CommentComposer, so a
save/delete busts every card through the count prop even with stable
comment arrays.

## Fix (per the ticket's primary option)

1. **Per-chunk selection inside ChunkCard** — the exact pattern the card
   already uses for `reviewed`:
   `useMindMap(useShallow((s) => s.reviewComments.filter(c => c.anchor.chunkId === chunk.id)))`
   (zustand 5's `useShallow` caches the filter result while its elements
   are reference-equal, so unrelated store changes produce the same array
   identity). The `comments` prop leaves `ChunkCardProps`; `StoryView`
   loses `commentsByChunk`; `BriefPage` drops the memo. `DiffTable` keeps
   its `comments` prop (it re-renders with its card; `RawSpanDiff` feeds
   it `[]`).
2. **Count selection inside CommentComposer** — the only real consumer of
   `existingReviewCommentCount` is the composer's submit label
   ("Start review" vs "Add review comment"). The composer selects
   `reviewComments.length` itself; the prop is deleted from
   CommentComposer, DiffTable, ChunkCard, StoryView, RawSpanDiff and
   BriefPage wiring. Only a mounted (open) composer subscribes, so a
   save/delete re-renders exactly the touched card + the open composer.
   Provider safety: CommentComposer only mounts from DiffTable with an
   active anchor, which only happens inside `MindMapProvider` (the
   RawSpanDiff path pins `activeCommentAnchor={null}` + no-op open).

Result: a comment interaction re-renders only the card whose chunk slice
changed. New facade hook `useChunkReviewComments(chunkId)` lives with the
session exports so the selector shape is owned by the store module, not
the component.

## Scope / PR breakdown

One PR (`feature/BRIEF-27/per-chunk-comment-selectors` → `main`), estimated
~120-180 changed LOC including tests — within the ideal.

| Part | Model / effort | Invocation |
| --- | --- | --- |
| Selector hook + rewiring (identity semantics are the subtle bit) | Fable, medium | main thread |
| Tests (identity stability, composer label, prop removal fallout) | Fable, low | main thread |

No subagent execution — smaller than the handoff cost.

## Specialist skills (mandatory)

- `git-eng` — all git operations.
- `typescript-eng` — repo TS standards.
- `vercel-react-best-practices` — memoization/selector discipline.

## git-eng requirements

Same contract as BRIEF-14: branch off `main` (stash the uncommitted
`docs/plans/brief-17-mergebrief-cli.md` around branch ops, never stage it);
chunked commits; `security-reviewer` + `performance-reviewer` on staged
changes before every commit (fix >=80-confidence, re-run until clean);
gates per commit `pnpm lint` / `pnpm -C apps/web typecheck` /
`pnpm -C apps/web test`; no attribution trailers. PR:
`[BRIEF-27] refactor: Per-Chunk Comment Selectors For ChunkCard`, base
`main`, Overview/Changelog body, local-verification note (CI billing-blocked).

## Implementation steps

1. `review/session`: add `useChunkReviewComments(chunkId)` (useShallow
   filter) exported from the session index; unit test identity stability
   (unrelated save keeps identity; own-chunk edit changes it).
2. `CommentComposer`: select `reviewComments.length` via `useMindMap`;
   drop the prop; update label test if any.
3. Remove `comments` + `existingReviewCommentCount` props down the chain
   (ChunkCard, DiffTable keeps `comments` only, StoryView, RawSpanDiff,
   BriefPage — delete the `commentsByChunk` memo).
4. Update DiffTable/ChunkCard tests for the removed props; wrap any test
   that now mounts a composer in `MindMapProvider`.
5. Verify, commit chunked, push, PR, review loop.

## Test notes

- Selector test via `renderHook` inside `MindMapProvider` (jsdom pragma,
  `afterEach(cleanup)`).
- DiffTable tests keep passing `comments`/anchors as props — only the
  count prop disappears there; none of them mount the composer today
  (`activeCommentAnchor: null`), so no provider wrapper is needed unless
  a new test opens it.
