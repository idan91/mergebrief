# Plan — P1 Front Door (brand surface): design + a11y scope

> **Status:** scoped, ready to build. Created 2026-06-30. Owns the detailed scope for
> [`oss-roadmap.md` → P1](../oss-roadmap.md). Read the roadmap first for *why* P1 leads.
>
> Purpose: turn the stranger's first impression into a no-signup, genuinely-impressive,
> taxonomy-led experience, and fold in the **important design + a11y fixes** found in the
> 2026-06-30 assessment (live app + code, via the `impeccable` and `web-accessibility` skills).

## Surface in scope

P1 = the **first-impression surface only**: the picker route (`/`, the front door), the
**README** + **static demo link** (the shareable artifacts), and **the brief a stranger first
lands on**. Deep internal review-flow polish (receipt, dismiss/evidence modals, author mode) is
*not* P1 — see Deferred.

## Decisions locked

- **Taxonomy-led framing.** The demo + README lead with the *already-built* differentiator —
  stable cross-PR **taxonomy + playbooks + risk-surface-as-facts** — not the parity features
  (categorize/group/summarize, which Atlas also ships). Don't polish a CodeRabbit-lookalike.
  (Agreed 2026-06-30.)
- **Pull P2's scope-check forward.** P2's read-only "what reasoned-ordering already exists?"
  check runs *inside* P1 (it's grilling-free and frontend-only) so the demo's framing knows
  what narrative slice, if any, it can show. (Agreed 2026-06-30.)
- **README may stake the AI-authored-code positioning now** ("built for the reality a machine
  wrote the code") in copy, ahead of the feature landing (candidate lens, post-P2). Free in prose.
- **Keyboard nav (#9) is IN P1** — full cheap-win: `J`/`K` advance/back, `Z` focus mode, `?`
  shortcuts hint. (Resolved 2026-06-30.)
- **Mobile brief header (#7) is DEFERRED** — the shared demo is desktop-framed, so the broken
  mobile header is not a first-impression blocker. Folds into the later responsive/a11y pass.
  (Resolved 2026-06-30.) Pull forward only if the demo's share target becomes a *live brief*
  that opens on phones.

## Assessment method (for re-measure)

Live app (`pnpm dev`) inspected via Playwright at 1440×900 and 390×844 (picker + a richest
brief), plus a11y-tree snapshots, the `impeccable` deterministic slop scan, and code review of
tokens / routes / `BriefPage` / `Header` / base styles. Rubrics: `impeccable` critique + audit,
`web-accessibility` (POUR / WCAG 2.2 AA).

**Baseline scores (re-run after fixes to confirm improvement):**

- Design (Nielsen 10): **26/40** — weak: Help/docs 1, Match-real-world 2, Flexibility 2.
- Audit (5 dims): **14/20** — Theming 4, Anti-patterns 3, Perf 3, **A11y 2**, **Responsive 2**.
- Slop scan: near-clean (only `overused-font` + `single-font` warnings). Design is *not* AI slop.

## In-scope checklist

Tags: `[copy]` `[design]` `[a11y]` `[brand]` `[kbd]`. A11y items cite the WCAG criterion.

- [x] **1. Rewrite the front-door copy** `[copy]` — **done 2026-06-30.** Picker (`routes/index.tsx`)
  now leads with "Turn a PR into a Brief", exact `CONTEXT.md` vocabulary (Change-group, Playbook,
  Risk Surface, "facts worth a closer look, never a verdict"), and three differentiator pillars
  (taxonomy, BYOK/no-telemetry, open Playbooks). Killed the author-facing jargon.
- [x] **2. Hero / "what is this" framing + real empty state** `[design]` — **done 2026-06-30.**
  Eyebrow + h1 + value-prop paragraph + pillars above the form; empty state (`briefs.length === 0`)
  rewritten as a real onboarding callout (paste-a-URL or `pnpm categorize` CLI fallback) instead of
  "No local brief outputs found." *(No in-app "demo brief" CTA — see item 11's resolution: the
  no-key look-before-install path is the external static demo, not a flag on local data.)*
- [x] **3. Fix `--faint` text contrast** `[a11y]` WCAG 1.4.3 AA — **done 2026-06-30.** `--faint`
  relit from `#62626b` (3.28:1, fails AA) to `#8a8a93` (~5.8:1, passes with margin for the top
  radial glow). `styles/tokens.scss`.
- [x] **4. Skip-to-content link** `[a11y]` WCAG 2.4.1 — **done 2026-06-30.** First focusable
  element in `__root.tsx`, targets a shared `#main-content` id now used by both the picker and
  brief `<main>` landmarks.
- [x] **5. Toast → live region** `[a11y]` WCAG 4.1.3 — **done 2026-06-30.** `BriefPage` toast got
  `role="status"` + `aria-live="polite"` + `aria-atomic`.
- [x] **6. Brief page needs an `<h1>`** `[a11y]` WCAG 1.3.1 — **done 2026-06-30.** PR title
  promoted from `<div>` to `<h1>` in `Header.tsx`; `.title`'s own `font-size` rule means no visual
  change.
- [x] **7. Favicon + `<title>` / OG meta** `[brand]` — **done 2026-06-30.** SVG favicon
  (`public/favicon.svg`) + description/OG/twitter-card meta in `__root.tsx`.
- [x] **8. Keyboard nav + focus mode** `[kbd]` `[a11y]` — **done 2026-06-30.** `J`/`K` step
  through `brief.chunks` document order via `jumpToChunk`; `Z` toggles focus mode (`data-zen` on
  `StoryView` + a `:has()`-based CSS rule in `base.scss` isolating the group/chunk carrying
  `data-current`); `?` opens a `ShortcutsModal`; `Esc` closes the modal first, then exits focus
  mode. Stands down while typing or while any drawer/modal/composer holds state. Respects
  `prefers-reduced-motion` (instant scroll). Verified live via Playwright (J/J, Z, ?, Esc×2).
- [x] **9. P2 scope-check (read-only)** — **done 2026-06-30. Result: ordering is structural,
  not narrative.** `buildBriefViewModel` renders groups in `brief.changeGroups` emission order;
  within a group, chunks sort by role (carrier→supporting) then `CONCERN_ORDER`
  (impl→test→doc→spec→config→generated). No dependency / reasoned-reading-order sequence across
  groups exists — confirms P2's premise. **Framing rule:** copy may claim taxonomy + risk-as-facts
  + playbooks (built); it must NOT claim "reasoned reading order / walkthrough" (that is P2).
- [x] **10. Top-tier README** `[brand]` — **done 2026-06-30.** New root `README.md`: leads with
  the taxonomy/Playbook/Risk-Surface story (per item 9's framing rule), the "why not CodeRabbit"
  differentiator list, BYOK/self-host/no-telemetry pitch, a self-host quickstart, and the
  AI-authored-code positioning line. **Flag for Idan: no `LICENSE` file exists in the repo; the
  README's License section says "TBD".** This is a real decision (which OSS license) that needs
  your call — not something to pick silently. MIT is the common default for this kind of project
  if you want a recommendation.
- [x] **11. Hosted static-demo link** `[brand]` — **resolved 2026-06-30, scope narrowed.**
  Surfaced a conflict with the 2026-06-22 build-in-private decision (no peer/hosting exposure
  yet). Clarified the artifact is a frozen, non-interactive snapshot (not the live usable app);
  Idan's call: **build the static export only, do not deploy.** `pnpm build` verified healthy
  (confirms all P1 changes compile into production output: `dist/client` + `dist/server`).
  **Not done:** an actual static (no-server) prerender of a single `/briefs/$briefId` route.
  TanStack Start's prerender path wasn't wired up this session — speculative new build config
  without a deploy target to verify against risked a half-finished result. **Next step, when
  ready to publish:** either configure `tanstackStart()`'s prerender option for one route, or
  mirror the rendered HTML from a running `pnpm dev` instance for one baked brief; deploy to
  GitHub Pages/Vercel/Netlify; then add the link to the README's (currently absent) demo section.

## Build order

All of P1 ships as one push; this is just the build sequence (only one hard dependency).

1. **Item 9 scope-check** — done. Gated the copy's framing. ✅
2. **Mechanical a11y/brand batch** — items **3, 4, 5, 6, 7**. No design decisions, characterization
   suite guards them, lifts Audit A11y 2→3+. Do as one batch.
3. **Keyboard nav** — item **8** (`J`/`K`/`Z`/`?`). Small self-contained feature; can run parallel to the batch.
4. **Creative core** — items **1, 2, 10, 11** (copy, hero/empty-state, README, demo). Design
   iteration via `impeccable shape`→`craft`; depends on item 9's framing rule (done).

## Deferred — with explicit triggers

Each item is real; the trigger says *when* it earns its slot so we don't lose it or do it early.

| Item | Tag | Trigger (do it when…) |
|---|---|---|
| **Mobile brief header** (meta stacks ~200px, timeline controls vanish) | `[design]` `[a11y]` 1.4.10 | The dedicated **responsive + SR a11y pass** before the first public/tagged release — bundle with touch-target sweep + manual SR pass. **Pull forward immediately** if the shared demo starts pointing at a live brief that opens on mobile. |
| **Declutter desktop header** (10+ controls competing) | `[design]` | **With P2** — the narrative/walkthrough nav reshapes the header controls; redesign once, then. |
| **Empty right column at top of brief** (summary half-width, big void) | `[design]` | **With P2** — the narrative layer repurposes that sticky column; don't polish it twice. |
| **Risk-surface button density** (Address/Dismiss selected + Addressed/Dismiss… per flag) | `[design]` | **When the AI-authored-code lens lands** (post-P2 candidate) — it adds attributes to Risk Surface, so redesign the row affordances once at that point. |
| **Touch-target sweep** (timeline `←`/`→`, "Viewed" checkbox likely <24px) | `[a11y]` 2.5.8 | The **dedicated a11y pass** (bundle with mobile header + SR pass). |
| **Distinctive display-font pairing** (only Instrument Sans) | `[design]` | A **brand-polish pass**, only if the identity ever needs to look more bespoke. Otherwise skip. |
| **Manual screen-reader pass** (VoiceOver/NVDA over the full review flow) | `[a11y]` | **Before the first public/tagged release** — the a11y pass above. |

## Won't do (rejected — don't re-litigate)

- **Remove the blue radial glow** on `body` — subtle, on-brand, not slop-level. Keep.
- **Chase AAA contrast (7:1)** everywhere — AA is the target; overkill.
- **Re-font just to satisfy the slop detector** — the two font warnings aren't worth a brand churn.
- **Hydration `caret-color:transparent` warning** — almost certainly browser autofill on
  `type=url`, not a real defect. Verify once, then ignore.
- **Deeper ARIA on the diff table** — already a real `<table>` with row/cell semantics. Leave it.

## Status: 10 of 11 items done (2026-06-30)

Items 1–10 shipped on `feature/p1-front-door` and verified (`pnpm typecheck` / `pnpm test` (79
passing) / `pnpm lint` / `pnpm build` all green; keyboard nav and the new picker copy verified
live via Playwright). Item 11 (hosted demo) deliberately scoped down to "build only, don't
deploy" — see its entry above for the concrete next step.

**Two things need Idan's decision before this can be called fully closed:**
1. **License** — README currently says "TBD" (item 10).
2. **When to actually publish the static demo** — item 11's deploy step, parked on purpose.

Re-run the `impeccable` audit/critique and `web-accessibility` checklist after merge to confirm
the Audit A11y (was 2/4) and Design Help/docs (was 1/4) scores move.

## Links

[`../oss-roadmap.md`](../oss-roadmap.md) (P1) · [`../vision.md`](../vision.md) (charter / brand)
· [`web-generate-from-url.md`](./web-generate-from-url.md) (the paste-URL flow) ·
[`../../CONTEXT.md`](../../CONTEXT.md) (Brief / Change-group / Risk Surface / Playbook vocabulary)
