# BRIEF-42 — Kill the Author/Reviewer Toggle (Single Brief View)

Execution plan for [ADR 0031](../adr/0031-single-brief-view-author-affordances.md)'s
kill ticket. Pure FE deletion: after it the app is single-view,
reviewer-flow only. No replacement behavior — the author-state affordances
build later to ADR 0031's locked contract (separate ticket, Backlog).

## Git requirements (git-eng — mandatory for all git operations)

- Branch from fresh `main`: `chore/brief-42-kill-author-toggle`.
- **Single commit** at the end (confirmed 2026-07-13) — one logical unit.
- **No pre-commit review agents** (confirmed) — suites + lint are the gate.
- Push and open a **ready-for-review PR** to `main`; Idan reviews + merges.
- PR title: `[BRIEF-42] chore: Kill Author/Reviewer Toggle — Single Brief View`.
- No `Co-Authored-By` trailers; no AI-attribution in the PR description.

## Specialist skills (user-confirmed)

- **typescript-eng** — mandatory. (TDD explicitly not adopted — existing
  characterization tests are updated, not written first.)

## Shape

One subtask, **one PR**. Measured surface: 9 files, ~30–40 reference lines
plus the `DemoControls` component folder; estimated diff **< 300 LOC,
mostly deletions** — far under the 500 ideal, no split.

| Part | Model / effort | Invocation |
| --- | --- | --- |
| Whole ticket | Sonnet 5, medium effort — mechanical deletion, no design decisions (all decisions are in ADR 0031) | Main thread, single session |

## Deletion inventory (verified 2026-07-13)

1. `features/review/state.ts` — the `ReviewMode` type (line 7).
2. `features/brief/components/DemoControls/` — delete the folder
   (`DemoControls.tsx` + `DemoControls.module.scss`); only consumer is
   `BriefPage`.
3. `features/brief/components/BriefPage/BriefPage.tsx` (12 refs) —
   `reviewMode` state (line 572), the `DemoControls` render + import
   (line 1360), the summary eyebrow author branch (line 1312 — keep the
   `delta`/`Brief` branch), the author toast copy (line 1186 — keep the
   reviewer copy), prop pass-throughs (lines 1253, 1455, 1474, 1481,
   1534), and the **`liveSubmit` gate** (line 1172).
4. `features/brief/components/Header/Header.tsx` (8 refs) — `reviewMode`
   prop, button label branch (line 175 → fixed `"Receipt"`), `HeaderMenu`
   prop, and the summary-preview link's `search={{ mode: reviewMode }}`
   (line 350).
5. `features/review/components/ReceiptDrawer/ReceiptDrawer.tsx` —
   `reviewMode` prop + three copy branches (lines 66, 73, 106); keep
   reviewer copy.
6. `features/review/components/PreSubmitModal/PreSubmitModal.tsx` — `mode`
   prop + heading/copy branches (lines 23, 25).
7. `features/review/components/SummaryPreview/SummaryPreview.tsx` — `mode`
   prop + title branch (line 37 → fixed `"Review Summary"`).
8. `routes/briefs.$briefId_.summary-preview.tsx` — `mode` search-param
   validation + prop pass (lines 15, 21–23, 32, 45).
9. `features/brief/components/Header/Header.test.tsx` — the one
   `reviewMode` test reference; update any characterization snapshots that
   capture `DemoControls` markup.

## Correctness constraints

- **The `liveSubmit` gate removal must not invert.**
  `liveSubmit = submitFlow.available && reviewMode === "reviewer"` becomes
  `submitFlow.available` — the DB submit flow stays live everywhere; the
  whole point is that flipping a radio no longer disables it.
- Copy branches collapse to the **reviewer** arm in every case; the
  author-mode copy fabricated an author receipt ADR 0009 rules out.
- The summary eyebrow keeps its `artifactKind === "delta"` branch.
- Prop removals shrink **exported** prop interfaces (repo convention:
  exported interfaces, so these are the files' own interfaces — no
  cross-package contract touched; CI path-filtering is not a risk here,
  but CI is currently down (ticket 37) — local suites are the only gate).

## Steps

1. Invoke `git-eng`; branch `chore/brief-42-kill-author-toggle` off fresh
   `main`.
2. Delete per the inventory above, in one pass (items 1–8), then fix tests
   (item 9).
3. Verify (exit codes are the judge, per standing feedback):
   ```sh
   pnpm -C apps/web typecheck
   pnpm -C apps/web test
   pnpm -C apps/web lint
   ```
4. Grep-audit zero survivors: `grep -rn "ReviewMode\|reviewMode\|mode=author"
   apps/web/src` must return nothing.
5. Single commit; push; ready PR to `main` per the git-eng section.
6. On merge: move BRIEF-42 to Done on the board.
