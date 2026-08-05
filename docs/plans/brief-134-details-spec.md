# BRIEF-134 — Details-section density: locked spec

Decision spec assembled from the completed wayfinder map
([map](https://app.notion.com/p/3b35e9400eeb81d28fabed2bfe1dd2bc), nine
tickets, all closed 2026-08-05). This is the WHAT; implementation planning
happens at pickup — one `/init-plan` covering all PRs. The header itself is
governed by `brief-103-header-spec.md` and is untouched here. Rendered
reference: `docs/plans/brief-134-region-mock.html` (self-contained; open in
a browser) — the mock is illustrative, this document is normative.

Baseline this spec was argued against: `brief-134-region-baseline.md` —
region cost (header bottom → first change group) was 1024px at 1440×900 and
up to 1451px at 1280×800; `SummarySection` alone was 65–94% of the region in
every mode. The assembled design measures **553px / 473px** — first group
plus two chunk cards above the fold at both viewports.

## Final flow order (Full + Story)

```
sticky header (two tiers, BRIEF-103)
  capped summary            ← scrolls away
  ▸ Intent check            ← scrolls away
  [reading toolbar]         ← sticky below the header (FocusBanner pattern)
  ▸ Conversation            ← scrolls away
  first change group …
```

The toolbar sits ABOVE the conversation disclosure: every control renders
above everything it governs, and the pinned toolbar stays reachable while
scrolling an expanded digest. (The first draft had it below — that put the
filter under a possibly-long digest it filters, rebuilding the defect
BRIEF-99's hoist fixed. Do not reintroduce.)

## The mode model: three axes, one legality table

Modes are not a flat list. Three axes — **Lens** (Story/Concerns, session
state), **Scope** (Full/Changes, URL `view` param), **Focus** (on/off,
session state) — and block presence DERIVES from the table below; no
per-block ad-hoc gating conditions (the old
`viewMode === "story" && !focusMode` soup is retired).

| | Full+Story | Full+Concerns | Changes | Focus |
|---|---|---|---|---|
| Summary + IntentBar (capped) | yes | yes | yes | no |
| Reading toolbar | yes (full) | yes (Filter + Risk attrs) | no | no |
| ▸ Conversation section | yes | yes | no | no |
| GroupTocBar (fixed gutter) | yes | no | no | no |
| Lens control (header) | active | active | **disabled + reason** | n/a (Story implied) |

- **Lens rule**: each lens announces and navigates itself. The lens
  preamble ("N chunks · grouped by intent" / "Attention split…") belongs to
  the lens component; the region never states a count. `StoryView`'s
  `chunksLabel` row DISSOLVES — its controls move to the toolbar.
- **Scope rule**: Changes-only DISABLES the lens control — grey,
  `aria-disabled`, honest reason ("Lens applies to the full brief") in the
  disabled-Compare-options pattern — never silently overrides it.
- **Focus rule**: focus EMPTIES the region entirely. Inline per-chunk
  threads remain; a filter set before entering focus still applies to them;
  changing the filter requires leaving focus. `Concerns+focus` does not
  exist — the current silent `setViewMode("story")` on focus entry
  (`useReadingSession.ts`) becomes an explicit contract.

## Capped-prose primitive (shared: SummarySection + IntentBar panel)

One shared component, never hand-rolled twice.

- **Cap**: 280px at ≥1440px viewport, 200px below. `--prose-cap` custom
  property.
- **Fade**: `mask-image: linear-gradient(to bottom, black 72%, transparent
  100%)` on the content itself — never a `var(--bg)` overlay gradient.
  Suppressed entirely in `fits` and `expanded`.
- **Detection**: `scrollHeight > cap + 8px` (hysteresis) →
  `data-state="collapsed" | "fits" | "expanded"`, maintained by a
  `ResizeObserver`. SSR default = `collapsed`; fitting content corrects to
  `fits` post-hydration with zero layout shift (only the toggle disappears).
- **A11y**: WCAG 2.4.11 via **focus-expands** — `focusin` inside the
  clipped region flips to `expanded`. No `inert`, no tabindex management.
- **Toggle**: text-like — borderless, no background, underlined (3px
  offset), 0.8125rem; copy `Show full summary ↓` / `Collapse summary ↑`,
  `aria-expanded`. Hidden in `fits`.
- **"Show original PR description" nests INSIDE the collapsible** at the
  end of the summary content (existing `descriptionToggle` register, one
  size down). Expanding the summary never auto-opens the description.
- **Motion**: 180ms `max-block-size` ease-out; suppressed under
  `prefers-reduced-motion`.
- Two-column-before-collapse REJECTED; the two-column changelog split is
  RETIRED once BRIEF-104 lands (single column always; the cap handles
  pre-104 artifacts).
- **IntentBar must NOT inherit the summary's 68ch measure** — it stays
  full-width (capped at 68ch it wraps 39px → 105px, a 66px region tax).

## Intent check placement (BRIEF-105 reconciliation)

The IntentBar moves to directly beneath the capped summary; its
de-emphasized register (five neutral uncolored counts, collapsed body,
never auto-expanded, fallible framing) is UNTOUCHED. ADR 0009 §86 rules
register, not visibility — the bar was buried by 826–1052px of summary, not
demoted by treatment. Capping the summary puts it above the fold; that IS
the promotion. ADR 0009 gets a compliance note, no amendment. The intent
panel body uses the capped-prose primitive when opened.

## Reading toolbar

One bar, in flow above the conversation section, `position: sticky` below
the header — the **FocusBanner pattern**: publish measured height as a CSS
var; sticky chunk headers pin below it. `--top-bar-h` does NOT change (its
stale 72px pre-hydration fallback vs the real 97px header is a separate
implementation nit to fix).

**Two clusters, split by auto-margin — no second bar, no internal border:**

- **Left = WHAT'S SHOWN** (subtractive/selective): `Filter` ·
  `Risk attrs · N` · `Collapse supporting`.
- **Right = WHERE YOU ARE** (positional): `◂ Group i/n ▸` (only <1120px,
  where the gutter TOC dies) · `◂ N changes ▸` (only when a comparison is
  active — `runCount > 0`; the right cluster may be legitimately empty).

Rules:

- Buttons + anchored panels only. Fixed height; **never wraps** — enforce
  with `flex-wrap: nowrap`, NEVER `overflow: hidden` (a fixed-height box
  with overflow-hidden CLIPS ITS OWN anchored panels — third instance of
  this bug family; see BRIEF-103's focus-mode menu clip). Panel z-index
  must clear the sticky chunk headers.
- The **label compression ladder is load-bearing** at 1280:
  `Risk attrs` → `Attrs`, `Collapse supporting` → `Collapse`. Spec'd, not
  improvised.
- `Collapse supporting` is an `aria-pressed` toggle button (no switch
  chrome). Never `disabled`-on-click (BRIEF-99 focus rule: `aria-disabled`
  + no-op where needed).
- `Start read-through` is an ENTRY action — it lives with the lens
  preamble's replacement in StoryView's flow, not in the toolbar, and
  scrolls away.
- In Concerns the toolbar carries `Filter` + `Risk attrs` only.

### Filter (the BRIEF-99 bar, re-homed)

The full-width in-flow `ConversationFilterBar` band DIES. The toolbar
trigger is the only filter surface:

- Inactive: plain `Filter` button (discoverable at zero state).
- Active: `Filter · 2 verdicts · 3 reviewers · 4 hidden` — hidden-thread
  count is the load-bearing number.
- Opens the full BRIEF-99 bar UI as an anchored panel (RiskChipDisclosure
  grammar). All BRIEF-99 locks hold inside the panel: OR-within/AND-across,
  faceted toggle-aware counts, zero-count chips unrendered, selected chips
  that zero out still render, recency toggle, All/None/Clear. Its a11y
  (focus management, `role="status"` announcements) must be RE-VERIFIED in
  the panel container.
- Renders whatever families the data has (reviewers without verdicts etc.);
  hidden entirely only when no family exists.
- Filter state stays in URL search params; `?thread=` landing targets stay
  filter-exempt.

### Risk attrs (replaces the in-flow AttributeJumpRail)

- Trigger `Risk attrs · N`; floor-attribute firing = emphasis dot on the
  trigger, never auto-open.
- Panel holds the RiskBadge chips with cycle-through-carriers intact.
  Targets are **groups in Story, chunks in Concerns** (ADR 0032 #11 holds:
  attribute-keyed, never group-ranked). `buildAttributeRail` gains the
  attr→chunkIds mapping alongside attr→groupIds.

## Conversation section

- Header shows **totals only** (`24 threads · 18 open`) — never filter
  state; filter state renders in exactly one place (the toolbar trigger).
- **Local/DB parity: the credential is the only divergence.** Three states:
  - **live** (connected repo + authed viewer): the DB path's surface
    verbatim — same fetch, same mutations (reply/resolve), same filter.
  - **snapshot** (no token / not connected / not authed): same components,
    writes VANISH (never render disabled), plus ONE muted line:
    `Snapshot from generation · <date> · Connect for live threads`
    (connect suffix drops when the repo has no installation). Resolution
    state renders as captured. No per-thread staleness treatment.
  - **absent** (pre-capture artifact): no surface, no placeholder.
- The stale-composer gating board ticket (head-advanced guard) applies to
  the live path and is inherited by parity.

## Out of scope / premises (do not build here)

- **BRIEF-104** (1–3-line summary + changelog prompt): sequenced AFTER this
  spec ships; amended with the target shape — summary = 1–3 line lede,
  changelog = 1–3 bullets, single column, no `## Changelog` split
  semantics. Eval-harness gate applies to it, not to this work.
- **Conversation capture + repo resolution** (separate ticket, filed at
  close-out): generation-time capture of review verdicts + `submittedAt` +
  bot flag, PR-level issue comments, thread resolution state, capture
  timestamp; snapshot→digest adapter; `owner/name → repoId` resolution for
  the live state. CLI-owned envelope metadata (ADR 0012) — does NOT trip
  the eval gate.
- Collapse-supporting in Concerns (ConcernView doesn't read `role`; new
  feature, not a re-wire).
- FocusBanner, GroupTocBar internals, header region (BRIEF-103).

## Implementation notes (earned, don't relearn)

- The eval gate is NOT tripped by any of this — FE-only; the capture
  ticket's stamping is CLI envelope metadata outside the model output
  schema (same ruling as BRIEF-103's state stamping).
- Visual PRs get an `/impeccable` audit on the rendered UI. Watch items
  from the prototype: intent row + toolbar are adjacent full-width bordered
  rows (confirm they read as different registers); the empty right half
  beside the 68ch summary at 1440 (pre-existing, shrinks post-104);
  tab-through auto-expand feel of focus-expands; snapshot-line wrap at
  narrow widths. Light-theme parity verified here too (`light-dark()`
  doesn't switch in static harnesses).
- BRIEF-99's owed `/impeccable` audit on the filter bar is FOLDED INTO
  these implementation PRs (the bar is redesigned into the panel; auditing
  the old band would be waste).
