# BRIEF-103 — Header density cleanup + PR state badge: locked spec

Decision spec assembled from the completed wayfinder map
([map](https://app.notion.com/p/3b15e9400eeb818abb14f6c823c341c0), seven
tickets, all closed 2026-08-03). This is the WHAT; implementation planning
(per-PR `/init-plan`) happens at pickup. Receipt semantics are unchanged
throughout (ADR 0002); ADR 0030 #6 (API vs local-CLI visibly distinct) and
ADR 0031/0032 constraints all hold.

## Identity row — single line (layout variant "one-line identity")

Order: `MergeBrief` wordmark ("/ review" suffix removed; logo swap is a
later, off-spec concern) · state badge · PR title (truncates first) ·
repo + `#N ↗` link (new tab) · provider/model badge · ⓘ Brief details ·
generation-warnings chip (when present) · self-review chip (own-draft only)
· [spacer] · **Submit** CTA · ⋯ overflow menu.

- Narrow viewports: everything AFTER the repo/PR link wraps to a second
  line; CTA + overflow stay pinned at the row end (existing ≤880px posture).
- No second facts row; no CodeRabbit-style grouped/bordered sections —
  both prototyped and rejected.
- The muted context line is REMOVED entirely. Artifact identity (brief _N /
  delta, short sha) already renders in the timeline navigator; everything
  else moves to the details panel.

## State badge

- GitHub conventions wholesale: Draft (gray) SUPERSEDES open; Open green /
  Merged purple / Closed red. Tinted pill (color-mix background + toned
  border — the self-review chip's treatment), NOT solid fill. Semantic
  tokens, contrast-checked both themes.
- SR: visible state word + sr-only "pull request" prefix.
- Data: DB path live via webhooks (`PrState` + `draft`). Local artifacts:
  stamp `state`/`draft`/`merged` into the artifact at generation —
  `fetchPullRequest` already returns state+draft and drops them
  (packages/github/src/operations/pull-request.ts); `merged` is in the same
  REST response, currently uncaptured. Staleness ACCEPTED — the artifact is
  a snapshot by design; no as-of hint.
- Eval-gate check (done at close-out): `pr`/`index`/`commitRange` are
  CLI-owned envelope metadata filled after generation (ADR 0012;
  brief-core types.ts) — outside the model output schema. The stamping
  does NOT trip the eval-harness convention gate.

## Provider/model badge — "keycap split" lockup

- Two-cell bordered lockup, 18px fixed height, `vertical-align: middle` so
  it rides INSIDE the meta-height line box (a draft that inflated the row
  was the prototype's first defect — fixed height + sm cell text is
  load-bearing). 8px before / 2px after.
- Cells: neutral mark cell (API/CLI tints rejected) → mono model cell →
  textual `API`/`CLI` end tag (xs, letter-spaced, line-height 1, 1px
  optical down-nudge). Class is carried in TEXT, never color alone.
- Model cell: full model id + effort (`claude-opus-4-8 · medium`).
  OpenRouter ids keep the author prefix (`anthropic/claude-opus-5`) —
  provenance never abbreviates identity.
- Logos: official brand SVGs BUNDLED as local assets (CSP/self-host safe;
  nominative use) for anthropic / openai / openrouter / claude-code /
  codex (registry tokens). SVG `aria-hidden` + sibling sr-only provider
  name. Unknown/self-hosted provider → provider token as text in the mark
  cell.
- The badge is NON-INTERACTIVE provenance chrome (badge-as-trigger
  rejected: commit range/timestamps are unrelated to the model).

## Submit CTA

- Header CTA copy: **"Submit"**. The receipt vocabulary moves one step in:
  the opened receipt surface's final CTA reads **"Submit with receipt"**.
  Never approve-adjacent (ADR 0002). Own-draft slot swap ("Mark ready for
  review", BRIEF-43) untouched.

## ⓘ Brief details — one shared panel

- Small ⓘ icon-button (`aria-label="Brief details"`) after the badge;
  anchored callout in the RiskChipDisclosure grammar (aria-expanded +
  aria-controls, hover preview, click canonical, Escape-at-capture).
- Three sections: **Artifact** (kind, brief index, commit range base..head
  + count, full SHAs, LOC "adjusted ≈ git" caveat — the killed stats
  popover's text) · **Generation** (provider, model, effort, timestamps,
  warnings prose) · **Repo config** (ok-state, table slimmed to file +
  applied-or-not + warning line when present; bytes-of-budget and per-file
  blob sha dropped — the chip label keeps the applied sha).
- The generation-warnings chip (below) opens this SAME panel.

## Chips

- **Generation warnings**: prose block removed from the header; compact
  amber count chip ("2 generation warnings") when warnings exist.
- **Repo config**: chip renders in WARNING state only (ADR 0032 #5 still
  satisfied); ok-state lives in the details panel. Keeps its own existing
  mini-callout.
- **Self-review chip**: kept, own-draft only; equal-or-bolder than today,
  adjacent to the Draft state badge (same story, told together).
- Registers stay distinct: state badge / provenance badge / stats — stats
  never become chips.

## Lens row (row 2) + progress

- One flat line: timeline/compare controls (flex-1 start) · stats group ·
  Story/Concerns (end). Both existing controls unchanged (they are the
  header's a11y high-water mark).
- Stats group MOVES here from the identity row: all three facts stay
  (adjusted lines / chunks / flags), own quiet register (mono numerals,
  hairline dividers); LOC popover killed (button becomes plain text — its
  a11y gaps become moot).
- Progress hairline unchanged (1px, aria-hidden, width transition +
  reduced-motion guard).

## Known defect riding along

- Focus mode clips the open overflow menu (stacking order/z-index) — fix
  with the header restructure PR.

## Implementation shape (each piece its own PR)

1. **Artifact stamping** — capture `merged` in the github op; carry
   state/draft/merged through `PrMetadata` into the artifact envelope; web
   parser accepts them (optional — old artifacts stay valid). Cross-package
   (github / brief-core / apps-web); run dependents' suites locally
   (BRIEF-23 path-filter gap).
2. **Header restructure** — one-line identity row, state badge, muted line
   removal, stats→lens row, popover kill, warnings chip, wrap rule,
   focus-mode z-index fix.
3. **Provider badge** — component + bundled brand SVG assets.
4. **Details panel** — ⓘ trigger, three-section callout, warnings-chip
   wiring, repo-config warning-only + slimmed table.

Prototype implementation notes: never wrap `TimelineNavigator` in a
shrink-to-fit container (kills its flex-1/container-query layout); keep
the progress bar's `inline-size` transition.
