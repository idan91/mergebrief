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

- [ ] **1. Rewrite the front-door copy** `[copy]` — kill author-facing jargon ("Local
  categorizer output", "Each generated output in tools/categorizer/out gets its own route and
  cache key"). Lead with what the tool *is* + the taxonomy/playbook edge. *Biggest single P1
  miss: the front door currently talks to the author, not a visitor.*
- [ ] **2. Hero / "what is this" framing + real empty state** `[design]` — one-line value prop;
  a no-key "look at a demo brief" CTA so a stranger sees value with zero setup. Today `/` is a
  bare file-picker that assumes you know what a "brief" is.
- [ ] **3. Fix `--faint` text contrast** `[a11y]` WCAG 1.4.3 AA — `#62626b` on `#0a0a0c` ≈
  **3.28:1**, fails 4.5:1 for normal text. Used for the front-door copy paragraph + eyebrow +
  meta lines (`.faint` class is systemic). Lighten the token (or restrict `--faint` to
  large/non-text use). `--dim #9a9aa3` ≈ 7:1 already passes — fine.
- [ ] **4. Skip-to-content link** `[a11y]` WCAG 2.4.1 — none exists; the dense header makes
  keyboard users tab forever. First focusable, on both routes. (`<main id="brief-content">` is
  focused on mount but there is no visible skip control.)
- [ ] **5. Toast → live region** `[a11y]` WCAG 4.1.3 — the toast is a plain `<div data-state>`
  (`BriefPage.tsx`); status messages ("Dismissed.", "Draft comment added.") are silent to
  screen readers. Add `role="status"` / `role="alert"` + `aria-live` (see `web-accessibility`
  Toast pattern). The empty `aria-live` span in `TimelineNavigator` should also actually carry text.
- [ ] **6. Brief page needs an `<h1>`** `[a11y]` WCAG 1.3.1 — the PR title is a `<div>`
  (`Header.tsx`); the page's first heading is `h2` ("Overview"). Promote the PR title to the
  single page `h1`.
- [ ] **7. Favicon + `<title>` / OG meta** `[brand]` — favicon 404s today; shared links need an
  OG card + favicon (the README/demo link is "the thing people share").
- [ ] **8. Keyboard nav + focus mode** `[kbd]` `[a11y]` — `J`/`K` next/prev chunk (and groups
  once P2 lands), `Z` focus/zen mode isolating the current unit, `?` shortcuts hint. Reuse the
  existing scroll-spy / active-id machinery + group TOC. Respect `prefers-reduced-motion`; don't
  hijack keys while a comment composer / input is focused. (Apply `web-accessibility` at build.)
- [ ] **9. P2 scope-check (read-only)** — confirm whether any explicit reasoned-sequence
  ordering of groups exists (current order is likely structural). Output feeds the demo framing;
  no build here. (Pulled forward from P2.)

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

## Done when

Front-door copy reads to a stranger; a no-key demo brief is one click from `/`; `--faint`
contrast, skip-link, toast live-region, and the brief `h1` all pass; favicon + OG present;
keyboard nav (`J`/`K`/`Z`/`?`) works; the P2 scope-check answer is recorded. Re-run the
`impeccable` audit/critique and `web-accessibility` checklist to confirm A11y and Responsive
move off their weak scores.

## Links

[`../oss-roadmap.md`](../oss-roadmap.md) (P1) · [`../vision.md`](../vision.md) (charter / brand)
· [`web-generate-from-url.md`](./web-generate-from-url.md) (the paste-URL flow) ·
[`../../CONTEXT.md`](../../CONTEXT.md) (Brief / Change-group / Risk Surface / Playbook vocabulary)
