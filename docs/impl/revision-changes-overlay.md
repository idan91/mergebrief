# Implementation Plan — Revision-Changes Overlay

**Design source of truth:** [ADR 0021](../adr/0021-revision-changes-overlay-on-full-brief.md). Glossary term: **Revision changes** in [`CONTEXT.md`](../../CONTEXT.md). Visual reference: [`mockup/revision-changes-compare.html`](../../mockup/revision-changes-compare.html) (Option 4 hybrid + deletion handling).

This plan implements the feature; it does not re-open design. Any design question that arises goes back to ADR 0021, not this doc.

> ## Git workflow — MANDATORY
>
> **All git operations for this implementation MUST go through the `git-eng` skill** — branch creation, commit chunking, the pre-commit review gate, push, and PR. Do not run raw `git commit` / `git push` / `gh pr create` outside it.
>
> - **Branch:** `feature/revision-changes-overlay` (already created; carries ADR 0021, the `CONTEXT.md` term, the mockup, and this plan).
> - **Commits:** chunked by logical unit — **one commit per slice below.**
> - **Pre-commit review gate:** run `performance-reviewer` on the staged diff before every commit (the FE slices touch render paths and virtualization — this is where it earns its keep). Findings ≥80 confidence: fix, re-stage, re-run until clean, then commit.
> - **PR:** open at the end via git-eng, base `main`. No AI-attribution trailers or footers (git-eng rule).

## Scope

In: the shared, per-revision (`prevHead→head`) mechanical highlight on the full Brief's Story view, Option 4 hybrid rendering, opportunistic callout, toggle, jump-nav, and v1 deletion handling (cases A + B).

Out (v2, do not build): selectable overlay baseline (`prevHead→head` vs `checkpoint→head`); the added-then-removed between-lines caret (case C). Leave TODO markers only.

Non-negotiables from the repo rules: TypeScript strict, no `any`, validate external data at the boundary (Zod or a `data is T` guard — no `as` on loaded JSON), named exports, co-located `*.test.ts`, React rules (no derived state, stable keys, event handlers over effects, semantic focusable elements). WCAG 2.2 AA for the overlay UI (ADR 0019 commitment).

---

## Slice 1 — Categorizer: emit the mechanical `prevHead..head` sidecar

The **only** non-FE / generation-side change. Mechanical git tree diff, **no LLM**.

**Files:** `tools/categorizer/src/diff.ts`, `tools/categorizer/src/output.ts`, `tools/categorizer/src/generator.ts` (wiring); new `tools/categorizer/test/revchanges.test.ts`.

**Work:**
- Resolve the previous briefed head from the PR's brief index (`out/<repo>-<pr>.briefs.json`). If this is the first brief (no previous head), emit nothing — the overlay is absent by design.
- Compute the unified diff `prevHead..head` (reuse the existing diff machinery; this is a second tree-pair diff, not the base→head one already produced).
- Emit a sidecar `out/<repo>-<pr>_<index>_<headsha>.revchanges.json`:
  ```jsonc
  {
    "headSha": "a01bcf1d",
    "prevHeadSha": "35788079",
    "prevIndex": 1,
    "files": [
      { "file": "src/...", "addedRanges": [{ "start": 32, "end": 34 }], "removedRanges": [{ "start": 45, "end": 45 }] }
    ]
  }
  ```
  `addedRanges` = head-line coords (join key for the FE). `removedRanges` = prevHead (old-side) coords, for deletion case B.

**Acceptance:** running the categorizer on a PR with ≥2 briefed heads writes a `.revchanges.json` whose ranges match a hand-checked `git diff prevHead..head`. First-head PRs write none. No model call is made for this artifact.

**Local-demo note (ADR 0019 #8):** emit the sidecar properly rather than leaning on the coincidence that the demo's `*.delta.json` spans consecutive heads — the demo must exercise the real shared/per-revision path.

---

## Slice 2 — Web types + read model load

**Files:** `apps/web/src/features/brief/types.ts`, `apps/web/src/features/brief/queries.ts`, `apps/web/src/features/brief/validation.ts`; route loader in `apps/web/src/routes/briefs.$briefId.tsx`.

**Work:**
- Add `interface RevisionChanges { headSha: string; prevHeadSha: string; prevIndex: number; files: RevisionChangeFile[] }` and `RevisionChangeFile { file: string; addedRanges: LineRange[]; removedRanges: LineRange[] }` (reuse existing `LineRange`).
- Add a boundary validator (`isRevisionChanges(data: unknown): data is RevisionChanges`) — no `as` on the loaded JSON.
- Query `revisionChangesQueryOptions(briefId)` that resolves the sidecar for the selected head; returns `null` when absent (first brief / no sidecar). Local: read the artifact; production: a head-keyed `GET` (ADR 0008 fetch shape, shared cacheable blob).
- Full route loader resolves `{ brief, revisionChanges }`; absence is a normal state, never an error.

**Acceptance:** loader returns `revisionChanges: null` on the first brief and a validated object on later heads; malformed JSON fails closed (overlay simply absent), not a thrown route error.

---

## Slice 3 — Overlay view model (the head-line join) + opportunistic callout binding

**Files:** new `apps/web/src/features/brief/revisionChanges.ts` + `revisionChanges.test.ts`.

**Work (pure functions, well-tested):**
- `markRevisionRows(chunk, revisionChanges)` → for each `DiffLine`, mark it a revision change iff `line.newLine ∈ addedRanges[file]` (adds/context at head). For `del` rows (no `newLine`), match `line.oldLine ∈ removedRanges[file]` (case B). Return per-row flags. **Perf:** build the per-file changed-line lookup once (a `Set`/`Map` of line numbers, or a sorted-range structure) — do **not** linear-scan the ranges per `DiffLine`.
- `groupRevisionRuns(markedRows)` → collapse contiguous marked rows into **runs** (one rail/affordance per run). A deletion-only run is its own run.
- `bindCallout(run, deltaArtifact | null)` → if a `(prevHead, head)` delta is loaded, resolve the run's change-group title + summary by the same head-line membership; else `{ available: false }` → "summary unavailable for this span." The marks never depend on this.

**Acceptance:** unit tests cover — pure add run, context-line-in-revision, standalone deletion (case B), a run split by an unrelated context line, first-brief (`revisionChanges == null` → zero marks), and callout-absent degradation. Join is head-line for adds/context, old-line for deletions; reverted lines (absent from `prevHead..head`) are correctly unmarked.

---

## Slice 4 — FE rendering: Option 4 hybrid in `DiffTable` + toggle

**Files:** `apps/web/src/routes/briefs.$briefId.tsx` (`DiffTable`, `StoryView` toolbar, state), `apps/web/src/styles/app.scss`.

**Work:**
- `DiffTable`: add a left **gutter column**; per run, render a focusable rail `<button>` (one per run, not per line) with an `aria-label` ("New in revision N: <group | 'changes'>. M lines." / "Removed in revision N: …"). Soft left-edge tint on at-head revision rows; a non-color **"new"** tag (adds/context) or **"removed"** tag (deletions). Reuse `--blue` (#7da7d9); note the existing `.delta` blue class at `app.scss:491`.
- **Callout** anchored to the rail: opens on **hover + focus + click**, **Esc** dismisses, persists while focused (WCAG 2.2 AA 1.4.13). Use an event handler for open/close (React rule), not an effect.
- **Toggle** in the Story toolbar: default **on** when `revisionChanges` has marks; **hidden on the first brief** (no sidecar); persist the user's choice (localStorage in the demo). Derive "has marks" during render — do not mirror into state.
- Deletions: case A (modification) needs no special work — the add side carries the marks; case B gets the rail on the red row (no tint/ted tag → "removed" tag). Case C → leave a `// TODO(v2): added-then-removed caret` marker, render nothing.

**Acceptance:** marks render only with the toggle on and a sidecar present; rail/callout reachable by keyboard and screen reader; green/red add-del coloring is unchanged underneath the blue channel; first brief shows no toggle. Matches the mockup's Option 4 + deletion block.

---

## Slice 5 — Jump-to-next/prev navigation

**Files:** `apps/web/src/routes/briefs.$briefId.tsx` (toolbar control + scroll/focus), small helper in `revisionChanges.ts`.

**Work:** compute ordered run anchors across the rendered Story view; toolbar shows the run count ("7 runs this revision") with **◂ prev / next ▸**. Clicking (or its keyboard equivalent) scrolls the next/prev run into view and moves focus to its rail button. Wraps or clamps at ends — pick clamp, announce position via the existing polite live region pattern. Must coexist with virtualization (resolve the target run, scroll it into the virtual window, then focus).

**Acceptance:** with N runs, next/prev visits each in order, focus lands on the rail, and it works from the keyboard alone. Count matches the number of runs from Slice 3.

---

## Cross-cutting risks to watch (already reasoned in ADR 0021)

- **Virtualization vs rail/run continuity** — a run spanning rows that virtualize in/out must keep one logical affordance; resolve runs from data (Slice 3), not from mounted DOM.
- **Deletion old-side join** — case B matches on `oldLine` against `prevHead` coords; verify against a PR where lines shifted between base and prevHead so head-line and old-line spaces genuinely differ.
- **Opportunistic core absence** — huge-span fallback / first-load: marks must still render; callout degrades to "unavailable." Test this path explicitly (Slice 3).
- **Don't muddy validation** — this overlay is the shared Full-brief surface; it is **not** part of the Phase 1 delta-lens dogfood (`docs/mvp/phase-1.md`). Ship behind the toggle; keep the dogfood on the per-reviewer Delta lens.

## Suggested commit chunking (one per slice, via git-eng)

1. `feat(categorizer): emit mechanical prevHead..head revision-changes sidecar`
2. `feat(web): load + validate revision-changes artifact`
3. `feat(web): revision-changes overlay view model + run grouping`
4. `feat(web): render revision-changes rail/tint/tag + callout + toggle`
5. `feat(web): revision-changes jump-to-next/prev navigation`

(The design-docs commit — ADR 0021, glossary, mockup, this plan — lands first, ahead of slice 1.)
