# BRIEF-195 — Retire Concerns lens, add S1 concern strip

Implementation plan for BRIEF-195. The design grill is DONE (2026-08-14, outcome
**Retire**); all 8 decisions are locked in the ticket's resolution comment, with
the v2 prototype attached there. This plan turns them into two stacked PRs.

## Locked design (source of truth: ticket resolution comment)

- **S1 strip**: one-line, full-width, panel-backed row rendered AFTER
  `UnattributedBanner`, BEFORE `ReadingToolbar`. Informational only — no
  filtering, navigation, or disclosure.
- **Measures**: concern name · mini share-bar · % · `+added/−deleted`. No
  chunk count.
- **Colors**: inherit the app's existing ChunkCard concern mapping
  (`ChunkCard.module.scss`): `implementation` = `--color-fill-bright`,
  `test` = `--blue`, `doc` = `--violet`, everything else (`spec`, `config`,
  `generated`) = `--faint` default. No new hues minted.
- **Gate**: renders only when the rollup holds ≥2 concerns; otherwise absent
  entirely (no placeholder) — same pattern as `UnattributedBanner`.
- **Responsive**: `flex-wrap` reflow only. No horizontal scroll, no
  collapsible, no width-dependent pruning. WCAG 1.4.10-clean.
- **Modes**: rides `blocks.summary` with full-brief rollup data everywhere —
  hidden in Focus, visible unchanged in Changes scope, viewed-revision data
  under compare with no delta treatment. Zero new legality branches.
- **Removal**: full retire in one move, no deprecation (`viewMode` was never
  serialized to URL — no compat surface).
- **Data source**: `brief.concernView` rollup (BRIEF-176 derivation engine) —
  already computed, stays.

## Mandatory skills and process

- **git-eng** — invoked explicitly for ALL git operations: branching, commits,
  push, PR creation. Stacked-PR mechanics (rebase `--onto` after squash-merge)
  per the established workflow.
- **typescript-eng** — strict TS, no `any`/bare `as`, named exports,
  const-map + `ValueOf` unions.
- **web-accessibility** — the strip is a new UI element; WCAG 2.2 AA,
  keyboard, visible focus (n/a — non-interactive, but verify no focus traps),
  reduced motion, high zoom.
- **impeccable** — used TWICE, both mandatory:
  1. **In-loop (PR 1)**: during strip implementation — visual hierarchy,
     spacing, alignment, and type-scale judgment on the rendered strip, plus
     the render-before-shipping rule: compile SCSS, screenshot via playwright
     at desktop (1280) and narrow (≤640) widths, MEASURE (row height, wrap
     behavior) before the PR goes up.
  2. **Audit gate (PR 2)**: after the retirement lands on the branch — the
     ticket-mandated full Impeccable responsive/visual inspection and
     mechanical detector pass over the affected surface (summary region,
     banner lane, toolbar, header controls), plus an axe pass. Findings of
     medium+ severity iterate before merge; nitpick-only = clean.
- **Commit strategy**: chunked logical commits; `performance-reviewer` gate on
  staged changes before each commit; `fable-reviewer` on each PR branch before
  handoff. Review-round budget: 2 max.
- **Model/effort**: Fable 5, **medium** effort, both PRs, sequential in the
  main thread (PR 2 depends on PR 1's branch).

Verification per PR: `pnpm -C apps/web typecheck && test && lint && build`
(build required — PR 2 changes the import graph). No eval runs — no
generation-surface files are touched (`concernView` derivation stays as-is).

## PR 1 — `feature/BRIEF-195/concern-strip` (~300–400 LOC)

Add the strip; the lens still exists and is untouched. Reviewable as a pure
feature.

1. **`ConcernStrip/` component** under
   `apps/web/src/features/brief/components/BriefScreen/ConcernStrip/`:
   - `ConcernStrip.tsx` — exported `ConcernStripProps`; consumes the rollup +
     brief totals; renders `role="group"` with a translated `aria-label`;
     segments carry `data-concern` for styling (repo convention: CSS targets
     attributes).
   - `ConcernStrip.module.scss` — panel-backed row (`--panel`, `--line`,
     `--radius-md`), `flex-wrap`, mono numerals; per-concern dot/bar colors
     via `[data-concern="..."]` selectors mirroring ChunkCard's mapping;
     tokens only, rem via `to-rem()` for text-coupled spacing.
   - `utils.ts` (co-located) — share computation
     (`(added+deleted) / total attributed`, vocabulary order) — closure-free,
     directly unit-testable.
   - `ConcernStrip.test.tsx` — jsdom pragma + `afterEach(cleanup)`; pins:
     ≥2-concern gate (0 and 1 concern → renders nothing), vocabulary order,
     share math, LoC values, aria-label.
2. **i18n**: new `brief.concernStrip.*` keys in `packages/i18n` catalog
   (lead label, aria-label template). Concern names render raw from data
   (existing convention in ChunkCard).
3. **Wiring**: `BriefScreen.tsx` — render between `UnattributedBanner` and
   the `GroupTocBar`/`ReadingToolbar` block, gated
   `blocks.summary && rollup.length >= 2`. No `modeLegality` changes.
4. **Impeccable in-loop pass** (skill invoked, not just eyeballed):
   screenshots at 1280 and ≤640, wrap measured, spacing/alignment judged
   against the prototype. Screenshots ride the PR body via the established
   SendUserFile + drag-drop flow.
5. Gates, `fable-reviewer`, PR up (base `main`).

## PR 2 — `feature/BRIEF-195/retire-concerns-lens` (deletion-heavy, ~800 LOC mostly red)

Stacked on PR 1. Mechanical retirement; the grill's boundary list is the
checklist.

1. **Delete** `ConcernView/` (component, scss, test) and
   `Header/LensViewbar/` + its Header wiring (`selectLens`, viewbar element).
2. **`useReadingSession`**: remove `viewMode`/`setViewMode`, the four
   snap-to-story sites (`toggleFocusMode`, `startReadThrough`, `jumpToChunk`,
   `exitToStoryView`), the brief-switch reset, and the scroll-spy lens gate —
   scroll-spy becomes scope/focus-gated only.
3. **`modeLegality.ts`**: drop the `lens` axis from `deriveRegionBlocks`;
   remove `CONCERNS_FOCUS_LENS_REASON` + `SCOPE_LENS_REASON`; `toolbar`
   collapses to a boolean-equivalent (full or hidden); update
   `modeLegality.test.ts` matrix.
4. **`ReadingToolbar`**: remove the `variant` prop and the
   `filter-and-attrs` branch; risk-attr target is groups only.
5. **`viewModel.ts`**: remove `concernChunks` (verify sole-consumer by grep
   first). `RiskChipDisclosure`/`RiskDetailList`: grep consumers — keep if
   Story still uses them, delete only if ConcernView was the last consumer.
6. **i18n**: remove `brief.concern.*` and
   `brief.header.viewConcerns/viewStory/viewLegend`; regenerate the catalog
   types.
7. **Tests**: delete `lensKeepWarm.test.tsx`; update Header, ReadingToolbar,
   characterization, and comparisonStateMatrix suites (fixture `concernView`
   arrays stay — the data is live). Coverage floors must not drop — deletion
   removes covered code, so verify each touched package still clears its
   threshold.
8. **Header check**: the controls tier keeps Scope/Compare, so `--top-bar-h`
   is expected unchanged — verify the measured height and the token comment
   still agree after the viewbar is gone.
9. **Impeccable audit gate** (skill invoked): full responsive/visual
   inspection + mechanical detector pass on the rendered app across summary
   region, banner lane, toolbar, and header controls; axe pass on the
   BriefScreen. Medium+ findings iterate; then gates, `fable-reviewer`,
   PR up (base: PR 1's branch, retargeted to `main` after PR 1 merges).

## Merge order

PR 1 → PR 2, squash-merge each; realign PR 2 via the established
rebase-`--onto` flow after PR 1 lands. Idan merges.
