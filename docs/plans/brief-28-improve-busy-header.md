# BRIEF-28 — Improve Busy header

Ticket: https://app.notion.com/p/3975e9400eeb8077946dcbea68612bc8 (blank —
scope derived from the code + an /impeccable product-register design pass).

## Diagnosis

The sticky Brief header is one 116px flex row holding EIGHT peer-level
clusters: wordmark, PR title + up to two meta lines, Timeline/Compare
controls, Story/Concerns switcher, three separate stats (adjusted lines
with popover, chunks, flags), the primary CTA, "Summary preview", and
"Clear local drafts" — plus the progress hairline. Everything sits at the
same visual level with uniform gaps, so nothing reads as grouped and the
rare actions cost the same attention as the primary one. Product-register
verdict: density is fine, undifferentiated hierarchy is the bug.

## Design (restrained, no capability loss)

1. **One meta line, not two.** Merge `artifactHeaderLabel` and
   `briefMetaLine` into a single truncating sub-line under the title
   (`repo · #N ↗ · local brief @ sha · brief _3 · range · via provider`).
   Header drops from 3 text rows to 2; `min-block-size` 116px → 72px
   (the runtime ResizeObserver keeps `--top-bar-h` correct).
2. **Stats become one group.** The three floating stats join a single
   quiet cluster with hairline dividers — one visual object instead of
   three. The adjusted-lines popover and all numbers stay.
3. **Rare actions demote to an overflow menu.** "Summary preview" and
   "Clear local drafts" move into a "More actions" (⋯) menu: proper menu
   semantics (aria-haspopup/expanded, Escape + click-outside close, focus
   return, arrow-key movement), 150ms fade-in, reduced-motion instant.
   The primary CTA ("Ready for review"/"Receipt") stays a top-level
   button — the only filled control in the header.
4. **Progress hairline** gains `aria-hidden` (the stats carry the same
   numbers textually) — it is a decorative duplicate.
5. No API change: `HeaderProps` is untouched; consumers (BriefPage local
   path, DB route via `controlsSlot`) need no edits.

## Scope / PR breakdown

One PR (`feature/BRIEF-28/improve-busy-header` → `main`), estimated
~250-350 changed LOC including a new `Header.test.tsx`. Under the ideal.

| Part | Model / effort | Invocation |
| --- | --- | --- |
| Header redesign (hierarchy, menu a11y semantics) | Fable, medium-high (design + a11y judgment) | main thread |
| Tests + visual smoke via dev server screenshot | Fable, low-medium | main thread |

## Specialist skills (mandatory)

- `git-eng` — all git operations.
- `typescript-eng` — repo TS standards.
- `impeccable` (product register) — drives the design pass (this doc).
- `web-accessibility` — menu pattern, focus management, contrast.

## git-eng requirements

Same contract as BRIEF-14/27: branch off `main` (stash the uncommitted
brief-17 plan edit around branch ops); chunked commits; security +
performance reviewers on staged changes pre-commit (fix >=80, re-run to
clean); gates `pnpm lint` / `pnpm -C apps/web typecheck` /
`pnpm -C apps/web test`; no attribution. PR
`[BRIEF-28] feat: Improve Busy Header`, base `main`,
Overview/Changelog/Images body, local-verification note (CI blocked).

## Implementation steps

1. `Header.tsx`: merged meta line; stats group markup; `HeaderMenu`
   (local component in the same file — it is header-specific): button +
   `role="menu"` popup with keyboard handling; progress bar aria-hidden.
2. `Header.module.scss`: zone rhythm (identity / controls / status+actions),
   stat-group dividers, menu styles (150ms ease-out fade/translate,
   `prefers-reduced-motion` instant), tightened min-height + responsive
   rules.
3. `Header.test.tsx` (new): jsdom + cleanup; menu open/close/Escape/focus
   return; both menu actions fire their callbacks; merged meta line
   renders index/range/origin; stats numbers render; keyboard nav.
4. Visual smoke: dev server + playwright screenshot at 1440/1120/880/560
   widths, wide-viewport check of sticky behavior.
5. Verify, commit chunked, push, PR, review loop.
