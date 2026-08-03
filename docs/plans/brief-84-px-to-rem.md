# BRIEF-84 — px→rem sweep: text scales with the reader, geometry stays fixed

Status: planned 2026-08-03, owner-approved for autonomous execution (grill
waived — the ticket's deferred judgment calls were settled by owner
instruction: spacing and text-coupled sizing convert too; border-radius and
chrome stay px). Board ticket: BRIEF-84 (In progress).

## Why

WCAG 1.4.4: a reader raising the browser's default font size should see
MergeBrief's text grow. Today the type scale is px (`tokens.scss`), so the
preference is inert. Inventory (2026-08-03): font-size is 99% tokenized —
the text fix is the 7 scale tokens + 2 disabled off-scale sites; the mass
is ~890 spacing/sizing px across 56 `.module.scss` files. `html` has no
font-size lock, so rem scaling works once values are rem. The seam exists
and is unused: `to-rem()` in `src/styles/_functions.scss` (2 call sites).

## Unit taxonomy (the decision — encode in ADR 0037 amendment, PR C)

**rem** (via `functions.to-rem(<px>)` — px stays readable in source;
compile-time, exact at the 16px root, so zero visual delta at defaults):

1. `font-size` — the 7 token definitions; the 2 off-scale sites keep
   their stylelint disables but convert value to rem.
2. All spacing rhythm: `margin*`, `padding*`, `gap`/`column-gap` — a
   component grows as a unit with its text.
3. Text-coupled sizing: `inline-size`/`block-size`/`min-*`/`max-*` (and
   physical `width`/`height`/`min-height`/`max-width`) on elements that
   contain or bound text — buttons, rows, inputs, drawers, prose measure
   caps (`980px` main column, `740px` drawer), touch targets (44px rows).
4. Spacing-like insets: offsets that separate content
   (`calc(100% + 6px)` dropdown gaps, list `text-indent`,
   `text-underline-offset`, `scroll-margin-*`).

**px** (stays — chrome, not typography):

- border widths/hairlines, `outline` + offset, `border-radius`,
  shadows/rings, `backdrop-filter` blur;
- decorative fixed geometry: icon boxes, scrollbar width + gradient
  masks (`rail-scroller`), the `--mag` rail magnification, transforms,
  split-grid scaffold tracks, the lone fractional `1.5px` inset;
- the `--top-bar-h` cluster (JS publishes runtime px; the sticky offsets
  and header min-heights coupled to it stay px together);
- media/container queries — px breakpoints unchanged this pass (layout
  behavior change; follow-up noted on the ticket);
- JS px constants (floating-ui `offset(10)`/`shift(8)`, `MAG_SIGMA`,
  callout `+12`) — decorative positioning, out of scope.

Ambiguity rule during the sweep: unclear → px (status quo) + note.
Already correct, untouched: unitless `line-height`, em `letter-spacing`,
em measure caps in `GroupCard`, the two em font-size exceptions.

## Git requirements (git-eng — mandatory for all git operations)

- Stacked branches off `main`: `feature/BRIEF-84/rem-text`,
  `feature/BRIEF-84/rem-spacing` (on A), `feature/BRIEF-84/rem-lint`
  (on B). Titles `[BRIEF-84] chore: ...`; standard Overview/Changelog
  bodies; no AI attribution, no Co-Authored-By.
- Chunked commits; `performance-reviewer` pre-commit on staged changes
  (owner's standing lean); security-reviewer skipped — style-only diffs,
  no security surface (any incidental finding still gets flagged).
- Per-branch gates: `pnpm -C apps/web lint`, `test`, `typecheck`,
  `build`, `pnpm -C apps/web test:e2e`. Eval gate n/a (no generation
  surface) — PR bodies still carry the explicit skip line.

## Work shape — 3 stacked PRs

### PR A — `rem-text` (main thread; ~120 LOC)

1. `tokens.scss`: 7 font-size tokens → `to-rem(...)` (needs
   `@use "functions"`); keep `--font-size-root` clamp as is.
2. The 2 off-scale font-sizes (`routes/index`, `SummaryPreview`) → rem
   values, disables intact.
3. Text-measure + text-flow conversions in `base.scss` (`.main`
   `max-inline-size`, `.skip-link`/`.btn` spacing) and
   `text-indent`/`text-underline-offset`/`scroll-margin` sites.
4. Sanity: `to-rem` divisor stays 16 (rem resolves against `html`, not
   the body clamp — document in the ADR amendment).

### PR B — `rem-spacing` (the mass; codemod + hand review; split into two
commits — `components/`+`routes/`+`styles/`+small features, then
`features/brief/` — target ≤ ~1000 changed LOC total, mechanical)

1. Codemod script (scratch, not committed): rewrite px → `to-rem(px)`
   for the taxonomy's property allowlist in `.module.scss`; add
   `@use "functions"` where missing; skip px-listed properties.
2. Hand pass over width/height/min/max and inset hits against the
   text-coupled rule; ambiguous → revert to px.
3. Visual verification: gates + E2E (zero-delta argument at defaults),
   plus a playwright spot-check at browser default font 20px on the
   fixture brief (text grows, chrome doesn't).

### PR C — `rem-lint` (~80 LOC)

1. Stylelint: extend `declaration-property-value-allowed-list` — ban px
   on `margin*`/`padding*`/`gap` (the always-rem families). font-size
   rule already bans all units (tokens carry the policy). Sizing stays
   judgment — no lint.
2. ADR 0037 amendment: the unit taxonomy above; apps/web `AGENTS.md`
   pointer line.
3. Ticket note: breakpoints-to-em follow-up explicitly out.

Run: main thread, sequential (stacked); no subagent fan-out — the
codemod does the mechanical part, judgment stays in-context. Model:
current session (mechanical + per-site judgment; no design phase left).

## Verification

- Per branch: the apps/web gates + E2E above, all exit 0.
- At default settings the transform is value-identical (to-rem exact);
  the E2E suite is the regression net.
- At 20px browser default: brief text visibly larger, borders/radii/
  shadows unchanged, no layout breakage on the fixture brief
  (screenshot spot-check, PR B).

## Out of scope

Breakpoints/media queries to em; a semantic spacing token scale
(ADR 0037 #5 trigger unchanged); JS-side px constants; brief-core or
non-web packages.
