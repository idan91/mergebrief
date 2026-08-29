# BRIEF-208 — Brief header title hierarchy: implementation plan

Goal: a reader landing on a brief sees the pull-request title as a page title —
24px at rest, shrinking to today's 13px as they scroll into the change groups —
and every heading in the app maps to a size by rule instead of by eye.

All decisions were locked on the BRIEF-208 wayfinder map and settled by its five
closed tickets. Nothing in this plan is open for re-litigation; where a step
looks arguable, the map's ticket already argued it.

## Ground rules

- **Git operations go through the `git-eng` skill, explicitly, every time.**
  Requirements gathered up front:
  - Feature branches off `main`, stacked in order:
    `feature/BRIEF-208/page-title-size` → `feature/BRIEF-208/heading-levels` →
    `feature/BRIEF-208/shrinking-header`, each based on the previous.
  - Chunked commits: commit after each logical unit.
  - **Pre-commit gate: `performance-reviewer` on the staged diff before every
    commit**; findings at confidence ≥ 80 get fixed and re-reviewed before the
    commit lands.
  - No `Co-Authored-By` trailers; no AI-attribution lines in PR bodies.
  - PR titles `[BRIEF-208] <prefix>: … ` in Title Case. No PR template exists in
    this repo, so bodies use the Overview / Changelog / Images shape. Push and
    PR creation are asked, not assumed.
- **Mandatory specialist skills (user-confirmed): `web-accessibility`,
  `impeccable`, `typescript-eng`, `verify` + `playwright-cli`.**
- **Render before believing any styling claim.** The map's Notes make this
  standing: compile, screenshot, measure. Never reason about sizes and ship
  blind. The file-backed brief route needs no database — `pnpm -C apps/web dev`,
  then `/briefs/Idan91-code-review-13_1_3a58e530`.
- **An `/impeccable` pass runs on the rendered result before any PR with a
  visual surface is opened.** That is PR 1 and PR 3; PR 2 is visually inert by
  construction and its bar is *no change at all*.
- Review lifecycle per the established stack flow: subagent review per PR, two
  rounds, address medium+ findings only; PR bodies pass `/unslop`; once all
  three are open, `watch-pr-stack` babysits the merges and realigns each branch
  as the one below it squash-merges.
- **Judge every gate by exit code, never by grepping output.** `pnpm lint`
  short-circuits on `&&`, so an early failure means `format:check` never runs;
  Prettier reports violations as `[warn]`, not "error". Run
  `cmd >/dev/null 2>&1; echo $?`, and lint each branch bottom-up — a rule can
  pass at the tip and fail mid-stack.

## Why the order is forced

`docs/adr/0037-fe-placement-and-token-conventions.md` is amended by PR 1
(the new scale step) and PR 2 (§10 Heading levels). One file, two additions, so
they land in sequence rather than in parallel. PR 3 depends on PR 1 for the
token it renders at.

## Part 1 — Adding the page-title size to the scale

Branch `feature/BRIEF-208/page-title-size`. **Estimated ~20 changed LOC.**

Ticket: [Adding the page-title size to the
scale](https://app.notion.com/p/3cb5e9400eeb81eebb83c040b0d9b6fa).

1. `src/styles/tokens.scss:121` — add `--font-size-4xl: #{functions.to-rem(24px)};`
   as the page-title step, and correct the `--font-size-3xl` comment. It reads
   `page titles`; it is the card and section heading step. Six places consume it
   and none of them is a page title.
2. **Move up to the new step** — three sites, verified present:
   - `src/styles/base.scss:57` — the bare `h1` rule.
   - `src/routes/routeShared.module.scss:12` — the shared route heading.
   - `src/routes/settings.module.scss:12` — the settings route heading.
3. **Leave where they are** — three sites, all card or section headings:
   `PrBrief/stateCard.module.scss:23`, `PrBriefError.module.scss:14`,
   `StoryView/GroupCard/GroupCard.module.scss:70`.
4. Record the new step in ADR 0037. The scale is a decision surface, not a
   dumping ground, so a change to it is a visual decision and belongs there.

**Checks.** `pnpm -C apps/web lint`, `pnpm -C apps/web test`. Render the
settings page and a route heading before and after — the new step is one size
up, not a shout. `/impeccable` pass before the PR.

**Run it:** sequentially in the main thread. Sonnet, medium effort — the edits
are mechanical; only the ADR wording needs care.

**Superseded during execution (owner call, on the render).** Part 1 ships
nothing but this plan. Two corrections, in order.

First, review round 1 caught that step 1's premise and step 2's site list were
both wrong about `routeShared.module.scss:12`. That `h1` rule is scoped
entirely under `.errorState`; every consumer of it (`index.tsx:145`,
`briefs.$briefId.tsx:111`) is a full-screen error card, and
`PrBriefError.module.scss` declares itself a byte-identical mirror of it. So
`routeShared` was never a page title and stays at `3xl`.

Then the owner looked at the rendered 24px title and **set the resting size to
20px, dropping the new scale step entirely.** That removes Part 1's whole
reason to exist: at 20px the page title uses `--font-size-3xl`, which
`base.scss`'s bare `h1` and the settings route heading already used, so no
token is added, no site moves, and ADR 0037 records no new step. The `3xl`
comment reading `page titles` becomes accurate rather than wrong, because the
brief header title joins the landing and settings headings on that step.

`3xl` now carries page titles AND card/section headings at one value. That does
not violate decision 5's "roles never earn a token at an equal value" — the
rule bans two tokens sharing a value, and this is one token serving both roles.
Hierarchy on the brief screen comes from row position and weight instead of
size, which is what the Part 3 amendment below rebuilds the header to give it.

## Part 2 — Applying the heading-level rules across the app

Branch `feature/BRIEF-208/heading-levels`, based on Part 1. **Estimated ~60
changed LOC** (13 one-line tag swaps, one selector rewrite, ~40 lines of ADR
prose, one AGENTS.md bullet).

Ticket: [Applying the heading-level rules across the
app](https://app.notion.com/p/3cb5e9400eeb814f9466d6ee8736d30a), carrying the
change list from [Which heading level each thing on the brief screen
uses](https://app.notion.com/p/3cb5e9400eeb81da884bd69c560d5243) and the final
app-wide wording from [Which heading level the screens outside the brief
use](https://app.notion.com/p/3cb5e9400eeb81599558d6fd92021a0c).

Thirteen lines across nine files. **Every one is visually inert** — each
affected element already pins its own size in its module, which is the charting
constraint working rather than luck.

| File | Change | Why it looks identical |
| --- | --- | --- |
| `ChangesOnlyView.tsx:171,183,325` | `h3` → `h2` | `.groupTitle` already pins `--font-size-xl` |
| `SubmitModal.tsx:170,200,302` | `h3` → `h2` | shell rule below |
| `RiskGroup.tsx:16` | `h4` → `h3` | unstyled in the JSX — **check at build time, do not assume** |
| `EvidenceModal.tsx:86` | `h3` → `h2` | shell rule below |
| `DismissModal.tsx:31` | `h3` → `h2` | shell rule below |
| `MarkReadyModal.tsx:93` | `h3` → `h2` | shell rule below |
| `ShortcutsModal.tsx:35` | `h3` → `h2` | shell rule below |
| `Modal.module.scss:36` | `h3 {` → `:where(h1, h2, h3, h4, h5, h6) {` | same declarations; `.modal :where(h2)` is 0,1,0 and still beats `base.scss`'s bare-tag 0,0,1 |
| `InlineThreads.tsx:43` | `h4` → `h3` | `.label` already pins `--font-size-sm` |

The Modal shell's bare `h3 {}` is what made all five modals pick `h3` in the
first place — a tag selector doing size work. The `:where(...)` rewrite means
the shell can never again be the reason a component picks a tag, at one line
instead of threading a class through six files.

**Nothing outside the brief screen moves.** The landing route, settings, the five
`PrBrief` state cards, the three error states and the summary preview all
already conform.

**Write it down.** A new **§10 Heading levels** in ADR 0037 carrying five
clauses in their app-wide wording, plus a Revisit Triggers entry, and one
enforceable bullet in `apps/web/AGENTS.md` under *Placement and styling*:

1. `h1` names what the screen is showing. Exactly one per screen — usually the
   page title; on a screen whose content is replaced by a state or error card,
   that card's heading is the `h1`.
2. `h2` is a top-level section **of the screen**.
3. Overlay content is its own outline, rooted at `h2`, never `h1`.
4. A level follows the nearest ancestor heading. No skips.
5. A tag is chosen by document structure, never to get a size.

§10 does not exist yet, so it is app-wide from its first commit and gains no
exception clause. Nothing here is machine-checkable —
`eslint-plugin-jsx-a11y` has no heading-level rule — so this stays a
reviewer-held convention, like the conditional-spread rule.

**Checks.** `pnpm -C apps/web typecheck`, `test`, `lint`. Screenshot the brief
screen and each of the five modals before and after. **The bar is no visual
change at all** — a difference means an element was relying on the shell's tag
selector for its size, which is exactly the coupling this part removes.

**Run it:** sequentially in the main thread, after Part 1's branch exists.
Sonnet, medium effort. `web-accessibility` governs the outline; the one place
to slow down is `RiskGroup`.

## Part 3 — Building the shrinking header

Branch `feature/BRIEF-208/shrinking-header`, based on Part 2. **Estimated
150–300 changed LOC** across `Header.tsx` (632), `Header.module.scss` (557),
`Header.test.tsx` (805) and `tokens.scss`. One PR — under the 500 ideal, and
splitting the DOM move from the animation would ship a half-built header.

Ticket: [Building the shrinking
header](https://app.notion.com/p/3cb5e9400eeb81cda9d2cb4f06bf53e4).

1. **Sizes.** The title renders at `--font-size-4xl` at rest and
   `--font-size-lg` collapsed.
2. **The shrink is CSS only.** `animation-timeline: scroll(root block)`,
   `animation-range: 0 100px`, wrapped in
   `@supports (animation-timeline: scroll())`, with `animation: none` under
   reduced motion. Both fallbacks land on a static 24px title. No scroll
   listener, no JavaScript. Firefox stable 154 has no scroll-driven animations,
   which is what the `@supports` guard is for — without it Firefox gets a
   permanently collapsed header.
3. **The header publishes its collapsed height at all times.** The existing
   `ResizeObserver` in `Header.tsx:115-128` keeps its write-only-on-change
   guard. This is the whole trick: eleven call sites pin geometry to
   `--top-bar-h` — `useReadingSession.ts:64`, `StoryView.module.scss:37,43`,
   `ChunkCard.module.scss:47`, `FocusBanner.module.scss:9`,
   `ReadingToolbar.module.scss:11`, `Header.module.scss:271`,
   `ConversationSection.module.scss:45`, `ExpandableContent.module.scss:11`,
   `DbBriefControls`, and the `tokens.scss` fallbacks. Publish an animated
   height and every one of them slides during scroll.
4. **Below 880px the title ships already-compact** — 13px, no shrink — so the
   header has one height at every width.
5. **The repo reference renders inside the riders group, at every width.** This
   is a DOM move, not a stylesheet change: CSS cannot reparent. The desktop row
   stays visually identical because `lead` and `riders` are both
   `display: contents` there. Focus order is unchanged and all 78 existing
   header tests pass with the move applied.
6. **The lead row reserves the 24px line box** (`min-block-size: 30px`
   measured). Without it the title owns its row's height and the header shrinks
   with the title — 155→142px at 1440 — which is the moving published height
   this design exists to avoid.
7. **The locale picker takes its own grid column above 880px, auto-placement
   below.** Given no column it lands on a third row on desktop (+37px); given a
   fixed column at narrow it starves the title to 15px at 375.
8. **The `tokens.scss` fallbacks move** — `--top-bar-h: 97px` (line 163) and the
   narrow `91px` (line 171) to roughly 119px and 115px. **Re-measure rather than
   trusting these numbers**: they were taken against a deliberately long title
   and repository name.

**Checks.** `pnpm -C apps/web typecheck`, `test` (characterization harness
included), `lint`, and `build` — build is required, it is the only thing that
catches server-only graph edges. **The landing assertions stay at 0px.** That is
the acceptance bar, not a nice-to-have — it is precisely what a header with a
moving published height would break. Screenshot 1440, 1024, 880, 640 and 375 in
both header states, then run an `/impeccable` pass on the rendered result before
opening the PR.

**Run it:** sequentially in the main thread. **Opus 5, high effort** — the DOM
move, the animation guards and the five-width geometry are subtle and
interdependent. (Fable where quota allows; on a quota hit, Opus 5 high and note
the substitution.)

## Out of scope

Both ruled out on the map, neither blocked by this stack, each needs its own
ticket when wanted:

- **Replacing the wordmark with a square logomark** — a brand and asset
  decision. A square mark is narrower than the 80px the wordmark holds at 375px,
  so it can only free width for the title.
- **Smooth scrolling for jumps within the page** — the second half of BRIEF-208
  as filed. It carries its own constraint: BRIEF-188 set `behavior: "auto"` on
  the revision-navigation path deliberately, because smooth fought the
  landing-position assertions and cost frames.
