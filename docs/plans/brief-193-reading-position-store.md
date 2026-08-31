# BRIEF-193 — reading-position store + memo hygiene

Ticket: refactor: scroll position updates re-render the whole brief screen
(BRIEF-193, Now). Scroll-spy writes `activeChunkId` into BriefScreen-level
state, so every spy tick re-renders the screen shell; the structure forces
defensive memoization (`revisionJumpTargets`, `chunkOrdinals`) and every
active-chunk consumer leans on memo boundaries.

## Goal

Reading-position state (`activeChunkId` + derived `activeGroupId`) moves into
a scoped zustand-in-context store so only real consumers subscribe. The screen
shell stops depending on it entirely. Then a memo/useCallback sweep over the
BriefScreen tree deletes memoization that only existed to survive the per-tick
re-render — memoize only for memoized-child prop identity or measured cost.

## Design

New store, co-located with the screen (`BriefScreen/readingPosition/`):

- State: `activeChunkId: string | null`, `activeGroupId: string | null`.
  Both set together by writers (the writer holds `model.chunkToGroup`);
  consumers never re-derive the group.
- Pattern: `createStore` (vanilla) + provider + selector hook — the
  ReviewFlow store recipe. Created by BriefScreen, provided next to
  `ReviewFlowProvider`, reset on brief switch.
- Writers (all inside `useReadingSession`, none subscribe): scroll-spy
  effect, `toggleChunk`, `jumpToChunk`, `markReviewed` (focus-mode advance),
  `toggleFocusMode`, `startReadThrough`, brief-switch reset.
- Subscribers (re-render per tick, nothing else does):
  - `ChunkCard`: subscribes `activeChunkId === chunk.id` itself; the
    `active` prop dies in both trees (StoryView plain + windowed list).
  - `GroupTocBar`, `ReadingToolbar`: subscribe `activeGroupId`; props die.
  - `FocusBanner` / `ReadThroughProgress`, `FocusGroupRail`: subscribe
    `activeChunkId`; props die.
  - `StoryView`: focus-mode `isActiveFocusGroup` via a selector gated on
    `focusMode` (spy is off in focus mode — changes only on explicit nav).
- Event-time readers (no subscription, no re-render):
  - `useKeyboardShortcuts`: `activeChunkId` prop becomes a getter reading
    `store.getState()` at keydown.
  - `useRevisionNavigation`: reads the store at jump time;
    `revisionJumpTargets` + `chunkOrdinals` derive inside the jump handler
    (gesture-time, cheap) — both BriefScreen `useMemo`s deleted.
- `useReadingSession` stops returning `activeChunkId`/`activeGroupId`;
  BriefScreen never touches either.

## PRs (stacked, both off main sequentially)

1. **PR 1 — `refactor/BRIEF-193/reading-position-store`** (~600–900 LOC with
   tests): store + provider, session rewire, all consumer/subscriber
   migrations, hook signature changes, delete the two defensive memos,
   test updates (store unit tests, readThrough characterization, shortcut +
   revision-nav hook tests).
2. **PR 2 — `refactor/BRIEF-193/memo-sweep`** (~200–400 LOC, mostly
   deletions): remove useMemo/useCallback across the BriefScreen tree that
   no longer earn their place (rule: feeds a memoized child, or measured
   cost). Includes a parent-child structure pass — flag/fix state placed
   above its real consumers.

## Verification

- `pnpm -C apps/web typecheck && pnpm -C apps/web test && pnpm -C apps/web
  lint` per PR.
- Perf specs vs main numbers (scroll smoke p95, rev-nav, lens-to-full,
  jump-far) — regression gate in each PR body; render-count assertion that a
  spy tick no longer re-renders the screen shell (profiler or render-count
  probe in a test).

## Execution

- Model: Fable 5, main session, both PRs sequentially (PR 2 needs PR 1's
  final shape).
- Skills (mandatory): `typescript-eng`, `tdd`.
- Git: all git operations through `git-eng`. Chunked commits;
  `performance-reviewer` gate pre-commit; `reviewer` on each PR
  branch before ready. No AI attribution in commits/PRs. PR titles
  `[BRIEF-193] refactor: …`.
