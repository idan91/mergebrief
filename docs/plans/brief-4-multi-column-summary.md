# BRIEF-4 — Multi-column Brief summary on wide viewports

Status: shipped (PR #119), then RETIRED by BRIEF-104 (2026-08-07) — the split is deleted; summaries render single-column always. Kept for history. Shape brief confirmed via /impeccable shape (this doc carries it).
Ticket: BRIEF-4 (Notion). Origin: PR #19 review, 2026-07-04.

## Problem

The summary section (`BriefPage.tsx:1963-2020`) burns a full screen of vertical
scroll in a single 68ch column (`BriefPage.module.scss` `.summary`) before the
reviewer reaches the first chunk. On wide viewports the space to the right is
wasted.

## Confirmed design brief (from /impeccable shape, 2026-07-18)

- **Layout:** 2-column grid on wide containers. Column 1 = overview +
  what-it-does prose. Column 2 = changelog + risk-surface chips (+ DeltaContext
  for delta briefs). 68ch cap **per column**, not per section.
- **Trigger:** container query on `.summary` (`container-type: inline-size`;
  precedent: `DiffTable.module.scss`). 2-col engages only when BOTH hold:
  - the `## Changelog` section exists in the summary markdown, AND
  - the container fits two ~55ch columns + gap (~120ch threshold).
  No changelog → always single column (risk chips stay under prose). Confirmed
  choice: "split only if changelog" — avoids a sparse orphan column.
- **Mechanism:** split `brief.summary` markdown at the `## Changelog` h2 in the
  viewModel (string-level, unit-testable, not in the component), render as two
  `<Markdown>` blocks placed via grid-template-areas.
- **DOM order invariant (a11y crux):** overview → what-it-does → changelog →
  risk surface, regardless of visual placement. Grid placement only; no DOM
  reordering. Keyboard/reading order must match today's.
- **Slots:**
  - `DeltaContext` (delta briefs): column 2, below risk chips.
  - PR-description toggle + expanded panel: full-width row below the grid.
  - `RiskChipDisclosure` popovers: verify no clipping — do NOT introduce
    `overflow` on the section.
- **Drawer:** comparison preview drawer (`summaryDrawer`) inherits behavior via
  the container query — no override (confirmed).
- **Register (impeccable/product):** structural responsive change only; no
  motion, no new component vocabulary, chip/heading styles untouched.

## Contract facts (verified in code)

- Summary markdown contract (`tools/categorizer/src/prompt.ts`): overview +
  what-it-does required; `## Changelog` **optional**. Delta variant: changelog
  = follow-up commits, framed "since you last looked".
- Focus mode hides the summary entirely (`BriefPage.tsx:1963`) — no work.
- Split/story layout narrows effective width — container query covers it.

## Mandated skills (user-confirmed)

Implementation MUST run under these skills, invoked explicitly:

- **git-eng** — ALL git operations (branch, commits, push, PR) go through the
  git-eng flow. No ad-hoc git.
- **impeccable craft** — the implementation itself runs as `/impeccable craft`
  with this doc's design brief as the confirmed shape (craft's internal shape
  phase is already satisfied; do not re-interview). Craft owns visual QA:
  browser screenshots at each breakpoint before hand-off.
- **typescript-eng** — strict-TS conventions for the viewModel split function
  and types (no `any`/bare `as`; named exports; Result for expected failures).
- **web-accessibility** — verify reading order, keyboard order, zoom behavior
  (WCAG 2.2 AA per PRODUCT.md); DOM-order invariant above is the acceptance
  bar.

## Git flow (git-eng, user-confirmed)

- Branch: `feature/BRIEF-4/multi-column-summary` off `main`.
- **Chunked commits**, one per logical unit (see parts below).
- **Pre-commit gate:** `performance-reviewer` on staged changes before every
  commit; findings ≥80 confidence get fixed and re-reviewed before committing.
- No `Co-Authored-By` trailers; no AI-attribution in the PR description.
- PR: **ready for review** (not draft), base `main`, title
  `[BRIEF-4] feat: Multi-Column Brief Summary On Wide Viewports`. Idan merges.

## Shape: one subtask, one PR

Estimated diff ≈ 250–400 LOC (split helper + tests ~120, JSX restructure ~80,
SCSS grid ~60, characterization touch-ups ~40) — well under the 500 LOC ideal;
no split warranted. Measure diff-stat after each part; if trajectory breaks
~700 LOC, stop and re-plan a split (hard gate per working agreement).

### Parts (= commit chunks)

1. **viewModel markdown split** — `splitSummaryAtChangelog` (exact name per
   repo idiom) in `apps/web/src/features/brief/viewModel.ts` + unit tests:
   with changelog, without, delta variant, changelog-first-heading edge, fence
   containing a literal `## Changelog` line (must not split inside a code
   fence).
2. **Layout** — `BriefPage.tsx` summary section restructure (two `<Markdown>`
   renders, grid areas, full-width description row) +
   `BriefPage.module.scss` (`container-type`, `@container` rule, per-column
   68ch, single-column fallback). Data-attr on the section for the 2-col state
   (test hook; hashed classes are not selectors — FE refactor lesson).
3. **Verification & polish** — characterization suite green
   (`src/characterization/briefScreen.test.tsx`), a11y pass (reading order,
   keyboard, 200% zoom), before/after screenshots: wide, split, focus, mobile,
   drawer, delta. `pnpm -C apps/web typecheck && test && lint` (exit codes are
   the judge).

### Model / effort / invocation

- Single part-stream, sequential, **main thread** (no subagents — one small PR,
  context is already loaded here).
- Parts 1–2: current session model (Fable), medium effort — part 2 is the
  design-sensitive piece and runs under `/impeccable craft`.
- Part 3: mechanical; low effort, same thread.

## Acceptance

- Wide viewport: summary height roughly halves when changelog present; first
  chunk visible sooner.
- No changelog / narrow container / split rail / drawer-narrow: byte-identical
  single-column DOM order and appearance (characterization green).
- Screen-reader/keyboard order unchanged in all modes.
- Risk-chip disclosure popovers render unclipped in column 2.
