# BRIEF-134 — Details-section density: implementation plan

Executes `docs/plans/brief-134-details-spec.md` @ `0b2b5912` (normative).
Rendered reference: `docs/plans/brief-134-region-mock.html`. Baseline
numbers: `docs/plans/brief-134-region-baseline.md`. Target: region
(header bottom → first change group) ≈ 553px @1440×900 / 473px @1280×800.

Out of scope here (own tickets): conversation snapshot capture + repo
resolution (board ticket, Backend/M — the three-state local surface ships
with it; PR 3 keeps the current DB-only rendering paths working); BRIEF-104
prompt change (after this stack).

## Process requirements

- **git-eng governs all git operations** — invoke the skill explicitly for
  branching, commits, push, PRs. No `Co-Authored-By` trailers; no
  AI-attribution in PR bodies.
- **Stacked PRs** off `main`, each based on the previous:
  `feature/BRIEF-134/capped-prose` → `feature/BRIEF-134/reading-toolbar` →
  `feature/BRIEF-134/filter-panel` → `feature/BRIEF-134/mode-legality`.
  Idan merges (squash); realign the stack per `git-push-workflow` memory
  (`rebase --onto`, never plain-pull a rebased branch).
- **Commits: chunked**, logical sequential units. Before EVERY commit:
  `security-reviewer` + `performance-reviewer` in parallel on staged
  changes; findings ≥80 confidence get fixed, re-staged, re-run until
  clean.
- **Review loop: `fable-reviewer` per PR** after gates pass (Opus 5, as all
  agents — standing rule 2026-08-05). Medium+ findings iterate;
  nitpick-only = clean.
- **Mandatory skills**: `typescript-eng` (repo TS discipline),
  `tdd` (test-first for the primitive's state machine and filter/facet
  logic), `web-accessibility` (focus-expands, aria-pressed, panel focus
  management, disabled-with-reason lens control), `impeccable`
  (iteratively DURING implementation on rendered UI, not only the
  post-PR audit gate — owner selection).
- **Render + measure before shipping CSS** (standing rule): compile SCSS +
  playwright screenshot + measure; the BRIEF-99 harness recipe is in the
  map memory. Light-theme parity must be checked in the real app
  (`light-dark()` doesn't switch in static harnesses).
- **Gates per PR**: `pnpm -C apps/web typecheck && pnpm -C apps/web test`,
  root `pnpm lint` (root, not per-package — exit code is the judge),
  `pnpm -C apps/web build`. Run dependents locally (CI is path-filtered).
- **Eval gate: not tripped** (FE-only; verified at map close-out).

## PR 1 — capped-prose primitive + prose blocks

Branch `feature/BRIEF-134/capped-prose`. Est. ~550 LOC. Model: Opus 5,
main thread.

1. `CappedProse` shared component (`apps/web/src/components/CappedProse/`,
   exported prop interface): `--prose-cap` 280px ≥1440 / 200px below;
   `mask-image` fade (black 72% → transparent), suppressed in
   `fits`/`expanded`; detection `scrollHeight > cap + 8` → `data-state`,
   `ResizeObserver`-maintained; SSR default `collapsed` (no CLS for
   fitting content); **focus-expands** (`focusin` in clipped region →
   `expanded`) — no `inert`; text-like toggle (`Show full summary ↓` /
   `Collapse summary ↑`, `aria-expanded`), hidden in `fits`; 180ms
   `max-block-size` ease-out under `prefers-reduced-motion` guard.
   TDD the state machine (jsdom pragma, `afterEach(cleanup)`).
2. `SummarySection` adopts it; `descriptionToggle` moves INSIDE the capped
   body (end of content); expanding summary never auto-opens description.
   Two-column split untouched (retires with BRIEF-104, not here).
3. `IntentBar` moves directly beneath `SummarySection` in `BriefScreen`
   (the in-flow `AttributeJumpRail` between them departs in PR 2 — this PR
   just reorders). IntentBar stays FULL-WIDTH (never 68ch — 66px wrap
   tax). Its opened panel body adopts `CappedProse`.
4. `/impeccable` pass on rendered result; measure region delta.

## PR 2 — reading toolbar

Branch `feature/BRIEF-134/reading-toolbar` (base: PR 1). Est. ~850 LOC —
near ceiling, kept whole because the bar, its panels, and the strip
deletions are one coherent reviewable unit; split attrs-panel out only if
it balloons. Model: Opus 5, main thread.

1. `ReadingToolbar` component above the conversation section slot in
   `BriefScreen`: `position: sticky` below the header (FocusBanner
   pattern — publish measured height CSS var; sticky chunk headers pin
   below it). `flex-wrap: nowrap`, **NO `overflow: hidden`** (clips its
   own panels — spec guard); panel z-index clears sticky chunk headers.
   Two clusters split by auto-margin: left = Filter (PR 3 wires it; this
   PR lands the slot) · `Risk attrs · N` · `Collapse supporting`; right =
   `◂ Group i/n ▸` (<1120px only) · `◂ N changes ▸` (only when
   `comparison.runCount > 0`).
2. Risk-attrs trigger + anchored panel (RiskChipDisclosure grammar):
   RiskBadge chips, cycle-through-carriers, floor firing = trigger
   emphasis dot, never auto-open. `buildAttributeRail` gains
   attr→chunkIds alongside attr→groupIds (Story targets groups, Concerns
   targets chunks — Concerns wiring activates in PR 4).
3. `Collapse supporting` becomes `aria-pressed` toggle button (switch
   chrome dropped). Label compression ladder at 1280 (`Risk attrs`→
   `Attrs`, `Collapse supporting`→`Collapse`) — container-query or
   measured, spec'd not improvised.
4. Deletions: in-flow `AttributeJumpRail` render (component logic reused
   by the panel); `chunksLabel` row dissolves — count line dies (lens
   preamble stays lens-owned), `Start read-through` stays in StoryView
   flow as an entry affordance, revision jump-nav moves to the toolbar.
5. `--top-bar-h` pre-hydration fallback nit: correct 72px → measured
   two-tier value (tokens.scss comment sync).
6. `/impeccable` + measure; verify no mount jump (sticky, not
   conditional-mount).

## PR 3 — filter re-home

Branch `feature/BRIEF-134/filter-panel` (base: PR 2). Est. ~600 LOC.
Model: Opus 5, main thread.

1. Toolbar Filter trigger: inactive = plain `Filter`; active =
   `Filter · N verdicts · N reviewers · N hidden` (hidden count
   load-bearing). Renders whatever families the data has; hidden only
   when no family exists.
2. The full BRIEF-99 bar UI re-homes into the anchored panel (all locks
   hold: OR-within/AND-across, faceted toggle-aware counts, zero-count
   chips unrendered, selected-zero chips still render, recency toggle,
   All/None/Clear). The in-flow `ConversationFilterBar` band dies;
   feature export surface updated.
3. A11y RE-VERIFIED in the panel container: focus management,
   `aria-disabled` + no-op (never disabled-on-click), `role="status"`
   region mounted-always/update-text, Escape-at-capture.
4. Conversation section header: totals only — filter state never appears
   there. URL filter state + `?thread=` exemption unchanged.
5. **BRIEF-99's owed `/impeccable` audit is absorbed here** — run it on
   the rendered panel + trigger against a real conversation (`/verify`
   recipe; note the four staleness corrections recorded in the map
   memory).

## PR 4 — mode legality

Branch `feature/BRIEF-134/mode-legality` (base: PR 3). Est. ~400 LOC.
Model: Opus 5, main thread.

1. Block presence derives from the spec's legality table — replace the
   ad-hoc `viewMode === "story" && !focusMode` gating in `BriefScreen`
   with one derivation (small pure helper, unit-tested).
2. Changes-only DISABLES the lens control: grey + `aria-disabled` +
   reason ("Lens applies to the full brief") in the disabled-Compare
   pattern — touches `Header.tsx` minimally (state in, no layout change;
   BRIEF-103 spec untouched).
3. Focus empties the region: filter bar/toolbar + conversation section
   leave in focus mode; inline threads keep the active filter.
4. Concerns: toolbar renders Filter + Risk attrs only (chunk targets);
   Concerns+focus made explicit (auto-switch documented or toggle
   greyed — implementer's call per spec).
5. `/impeccable` sweep across all five configurations; final region
   measurement vs the 553/473px target recorded in the PR body.

## Sequencing & invocation

Strictly sequential (each PR bases on the previous), main thread, Opus 5
throughout — no parallel subagent implementation; `fable-reviewer` +
pre-commit reviewers are the only subagents. After each merge, realign the
remaining stack (squash-merge realign per memory). Manual smoke on the
local demo path per PR (`pnpm -C apps/web dev`, artifacts from
`tools/categorizer/out`; only artifact 194 renders an IntentBar).
