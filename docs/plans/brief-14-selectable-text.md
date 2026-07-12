# BRIEF-14 — Make Text Selectable (header + code)

Ticket: https://app.notion.com/p/3935e9400eeb80f7a6aed324f422a18a (content: "Header, Code")

## Problem

Two surfaces in the Brief page swallow native text selection:

1. **Code (DiffTable).** Every diff row's `onMouseDown` calls
   `event.preventDefault()` (`DiffTable.tsx:258`) to run the drag-to-anchor
   comment selection. That kills browser text selection for the entire diff —
   a reviewer cannot copy a line of code.
2. **Header (ChunkCard head).** The chunk header (file path + chips) is one
   big `<button>`; UA stylesheets make button text unselectable
   (Firefox/Safari `user-select: none`), so file paths can't be copied.
   The page-level `Header` component's text (PR title, repo, shas) is already
   selectable — no change there.

## Design

**DiffTable — split the two gestures by column:**

- Range drag-to-anchor starts only from the line-number cells (already
  `user-select: none`): `preventDefault` + `dragStart` move to a
  mousedown handler that checks the event target is a line-number cell.
- Code cell mousedown is left native → text selection works.
- `finishSelection` (row `mouseUp`) gains a guard: if
  `window.getSelection()` is non-collapsed, the user was selecting text —
  skip composer entry. Plain click (collapsed selection) still opens the
  single-row composer, so the existing click-to-comment affordance is kept.
- Keyboard path (`Enter` on row) unchanged. Read-only revision guard
  (`composerDisabledReason`) unchanged.

**ChunkCard — selectable file path inside the toggle button:**

- `.file` span gets `user-select: text` (overrides the UA button rule).
- The toggle `onClick` gains the same non-collapsed-selection guard so
  selecting the file path doesn't collapse/expand the chunk.

## Scope / PR breakdown

One PR (`feature/BRIEF-14/selectable-text` → `main`): estimated ~80–140
changed LOC including tests — well under the 500 ideal.

| Part | Model / effort | Invocation |
| --- | --- | --- |
| DiffTable + ChunkCard interaction changes | Fable, medium (selection-vs-gesture disambiguation is subtle) | main thread |
| Tests (DiffTable selection guard, ChunkCard toggle guard) | Fable, low | main thread |

No subagent execution — the whole ticket is smaller than the handoff cost.

## Specialist skills (mandatory)

- `git-eng` — all git operations (requirements gathered; see below).
- `typescript-eng` — repo TS standards.
- `web-accessibility` — the rows/buttons are interactive elements; keyboard
  path must stay intact.

## git-eng requirements

- Branch `feature/BRIEF-14/selectable-text` off `main`. Stash around branch
  ops (uncommitted `docs/plans/brief-17-mergebrief-cli.md` must survive
  untouched and never be staged).
- Chunked commits; before every commit run `security-reviewer` +
  `performance-reviewer` on staged changes, fix >=80-confidence findings,
  re-run until clean.
- Gates per commit: `pnpm lint` (exit code), `pnpm -C apps/web typecheck`,
  `pnpm -C apps/web test`.
- No `Co-Authored-By`, no AI attribution anywhere.
- PR: `[BRIEF-14] feat: Make Header And Code Text Selectable`, base `main`,
  Overview/Changelog body, note local verification (CI billing-blocked).

## Implementation steps

1. `DiffTable.tsx`: move drag initiation to line-number cells; drop
   row-level `preventDefault`; add selection guard in `finishSelection`.
2. `ChunkCard.tsx` + `ChunkCard.module.scss`: `user-select: text` on
   `.file`; selection guard on toggle click.
3. Tests in `DiffTable.test.tsx` (+ new `ChunkCard.test.tsx` if absent):
   jsdom pragma + `afterEach(cleanup)`; selection-guard behavior both ways.
4. Verify, commit chunked, push, PR.

## Test notes

- jsdom `window.getSelection()` exists; tests can stub
  `document.getSelection` ranges via `fireEvent` + manual selection API.
- Existing BRIEF-24 read-only tests must stay green (Enter/mouse inert).
