# BRIEF-103 — Header implementation plan

Executes the locked spec `docs/plans/brief-103-header-spec.md` (main @
daa3cbca; decisions are settled there — this plan is HOW, not WHAT). Four
PRs, sequential stack. Board ticket:
[Header density cleanup + PR state badge](https://app.notion.com/p/3b05e9400eeb811a9e20d59f369c869d).

## Git (git-eng mandatory for all git operations)

- Branches off main, stacked in order:
  `feature/brief-103-artifact-state` → `feature/brief-103-header-restructure`
  → `feature/brief-103-provider-badge` → `feature/brief-103-details-panel`.
- HTTPS + gh credential helper; squash-merge stack maintenance via
  `rebase --onto` after each merge — never plain-pull a rebased branch.
- Chunked commits per logical unit; no Co-Authored-By trailers, no AI
  attribution in PR bodies. Idan merges; upstream-first fixes (a defect
  found in PR N that belongs to PR N−1 is fixed in N−1, never patched over
  downstream).
- PR bodies note the eval-gate check outcome (not tripped — CLI-owned
  envelope metadata, ADR 0012); no eval run required.

## Mandatory skills during implementation

- `typescript-eng` — repo-wide strict-TS conventions.
- `web-accessibility` — state-badge SR labels, panel disclosure semantics,
  focus order (PRs 2 and 4 especially).
- `frontend-design` — visual work in PRs 2–4.
- `impeccable` — the design-audit gate (below), PRs 2–4.

## Review loop (every PR)

1. Implementation-time rigor first (fewer reviewer rounds by design).
2. `fable-reviewer` subagent on the branch diff; `performance-reviewer` on
   staged changes. Medium+ findings iterate; nitpick-only = clean.
3. **Design-audit gate (PRs 2–4 only, Idan 2026-08-03): run
   `/impeccable audit` against the RENDERED header** — dev server +
   browser screenshots (both themes, wide + ≤880px wrap state, own-draft
   and warnings variants where the PR touches them) judged against the
   spec. Triage its findings at the same medium+ bar. Rationale: the
   BRIEF-103 prototypes produced three defects (inflated line box,
   floating tag, clipped menu) that were invisible in the diff and
   instant in a screenshot — code review alone cannot see rendering.
   PR 1 is data plumbing: code review only, no design gate.

## Verification (per PR)

`pnpm -C apps/web typecheck && test && lint && build` — `build` required
for PR 1 (isomorphic parser surface) and any PR touching server-reachable
modules. PR 1 is cross-package: run `github`, `brief-core`, and `apps/web`
suites locally before pushing (BRIEF-23 path-filter gap — CI will NOT run
dependents).

## PR 1 — Artifact state stamping

~250 LOC · Opus 5, medium effort · main thread.

1. `packages/github` `fetchPullRequest`: capture `merged` (same REST
   response; `state`/`draft` already returned). Extend op tests.
2. `packages/brief-core`: add `state`/`draft`/`merged` to `PrMetadata` and
   carry into the artifact envelope's `pr` block (CLI-owned metadata,
   ADR 0012 — model output schema untouched). Old artifacts stay valid:
   fields optional end to end.
3. `apps/web` artifact parser (zod): accept the new optional fields; wire
   through the `Brief` type. Route/queryFn parser tests against realistic
   wire bodies (route tests that seed the cache bypass parsers).
4. DB path needs no change (PrState + draft already live via webhooks).

## PR 2 — Header restructure

~850 LOC (largest; measured per part — if the diff trends past ~1000,
split the focus-mode z-index fix + stats move into a lead-in PR) ·
Opus 5, high effort (focus-continuity and characterization-test surface
is where regressions hide) · main thread, after PR 1 merges.

1. Identity row → single line per spec order; wordmark loses "/ review".
2. State badge component: tinted pill, GitHub colors, draft supersedes
   open, sr-only "pull request" prefix; renders only when state present
   (pre-stamping local artifacts simply omit it).
3. Remove the muted context line + `briefMetaLine`; artifact identity
   stays in TimelineNavigator.
4. Stats group moves to the lens row (controls flex-1 · stats · Story/
   Concerns); LOC popover deleted, cell becomes plain text.
5. Generation-warnings prose → compact amber count chip (panel wiring
   lands in PR 4; until then the chip reuses `RiskChipDisclosure` with the
   prose as detail so warnings never go dark between PRs).
6. Narrow-viewport wrap rule: everything after the repo link wraps; CTA +
   overflow pinned (adapt the ≤880px block).
7. CTA copy `Receipt` → `Submit`; receipt surface's final CTA gains
   "Submit with receipt". Own-draft slot swap untouched; self-review chip
   equal-or-bolder, adjacent to the Draft badge.
8. Fix the focus-mode overflow-menu clipping (stacking order/z-index).
9. Implementation notes from the prototypes: never wrap TimelineNavigator
   in a shrink-to-fit container; keep the progress bar's `inline-size`
   transition + reduced-motion guard; badge-height discipline (fixed
   height, `vertical-align: middle`) applies to every row-riding chip.
10. Update characterization/header tests; focus-continuity tests for the
    terminal slot must stay green.

## PR 3 — Provider/model badge

~350 LOC · Opus 5, medium effort · main thread, stacked on PR 2.

1. Keycap-split component per spec: neutral mark cell → mono model cell
   (full model id + ` · effort`; OpenRouter author prefix kept) → textual
   `API`/`CLI` end tag (xs, letter-spacing, line-height 1, 1px down-nudge).
   18px fixed height, `vertical-align: middle`, 8px/2px margins.
2. Bundle official brand SVGs as local assets (anthropic / openai /
   openrouter / claude-code / codex per the generators registry): download
   from each provider's brand kit, minify, commit under the component;
   `aria-hidden` + sibling sr-only provider name. Unknown provider →
   token as text in the mark cell.
   **Accuracy gate (Idan, 2026-08-03): the mark must be the provider's
   REAL logo, verifiably one-to-one from an official source (brand kit,
   press page, or the provider's own site assets) — hand-drawn
   approximations are forbidden in shipped code.** Any provider whose
   accurate mark cannot be sourced falls back to a single generic
   provider glyph + the provider NAME as text inside the pill (the
   unknown-provider treatment), and a "provider logo assets" board
   ticket is filed to close the gap later. Partial shipping is fine —
   accurate marks for some providers, named fallback for the rest.
3. Non-interactive (no button semantics). Adapter-class mapping stays the
   header's plain-data copy (no SDK imports into the client bundle).
4. Replace the interim "via …" remnant from PR 2; component tests incl.
   unknown-provider fallback.

## PR 4 — Brief-details panel

~500 LOC · Opus 5, high effort (disclosure a11y is the hard part) · main
thread, stacked on PR 3.

1. ⓘ icon-button (`aria-label="Brief details"`) after the badge; anchored
   callout in the `RiskChipDisclosure` grammar (aria-expanded +
   aria-controls, hover preview, click canonical, Escape-at-capture).
2. Three sections: Artifact (kind, brief index, commit range + count, full
   SHAs, LOC "adjusted ≈ git" caveat) · Generation (provider, model,
   effort, timestamps, warnings prose) · Repo config (ok-state; table
   slimmed to file + applied-or-not + warning line; bytes and per-file
   sha dropped).
3. Warnings chip rewires to open THIS panel (landing on the warnings
   section); repo-config chip becomes warning-only, keeps its mini-callout.
4. Panel a11y tests (keyboard path, Escape, SR labels) + section-content
   tests across brief/delta artifacts.

## Sequencing note

Strictly sequential (each PR builds on the previous surface); same model
throughout → main-thread execution, no subagent fan-out. Reviews +
design audits run per PR before the next starts (upstream-first keeps the
stack honest).
