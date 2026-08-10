# BRIEF-162 — core-line counts (header, group cards, details panel)

Implementation plan. Decisions grilled + prototyped 2026-08-10 and LOCKED on the
ticket (BRIEF-162); this doc carries the build order, not the debate. The
prototype (static HTML, real tokens) picked the winners below.

## Locked decisions (from ticket)

- **Word: "core"** in ALL user-visible copy. Internals keep `carrier` (the
  full rename is its own ticket, lands after this one). This PR sweeps every
  existing user-visible "carrier" string (role badges, unreviewed-carrier gate
  copy, aria labels) so the app never shows both words.
- **Header statsGroup**: core REPLACES the adjusted-lines cell — no fourth
  cell. Label `core lines`, value `≈ +318 / −54`. Hover/focus opens a mini
  details panel: core lines + all adjusted lines + caveat ("Adjusted
  approximation — not the raw git count. Exact lines are on GitHub.").
- **GroupCard eyebrow**: core-only — `≈ +141 / −28 core · 3 core ·
  2 supporting` — same mini-panel on hover/focus with group-scoped numbers.
- **BriefDetailsPanel**: keeps BOTH rows — `adjusted lines` + new `core
  lines`; caveat extended to cover core.
- Semantics = role `carrier` (holds the group's intent), not concern
  `implementation`. LoC values are model-emitted adjusted approximations.
- Display-only: no generation-surface touch, no eval run.

## Hard constraints

- **Popover clipping**: GroupCard `.head` is `overflow: hidden auto`
  (`GroupCard.module.scss`) and the header has sticky/backdrop-filter
  contexts — the popover must portal (or use `position: fixed` anchor math)
  to escape. The header overflow-menu portal pattern is the reference.
- **Popover trigger must be focusable** (button semantics, keyboard + touch
  reachable; Escape dismiss). Hover-only is dead on touch and keyboard.
- `≈` needs screen-reader text ("approximately").
- Zero-edge: a core chunk set can be `+0 / −N`; renders as-is, no special case.

## Git (git-eng mandatory for ALL git operations)

- Branch off `main`: `feature/BRIEF-162-core-line-counts` (confirm name at
  impl start).
- **Chunked commits** — one per part below. Before EVERY commit:
  `performance-reviewer` on staged changes; findings ≥80 confidence get fixed
  and re-reviewed before committing.
- No `Co-Authored-By` trailers; no AI-attribution in PR body.
- One PR, base `main`, title `[BRIEF-162] feat: Surface Core-Logic Line
  Counts`. Estimated ~600–750 changed LOC total (over the 500 ideal, under
  the ceiling — accepted by Idan 2026-08-10).

## Mandatory skills

- `typescript-eng` — all TS work.
- `web-accessibility` — popover trigger/portal semantics, sr-only text, axe
  pass on touched surfaces.
- `impeccable` — audit on the RENDERED UI post-impl (standing rule for visual
  PRs), plus render-and-measure screenshots before shipping CSS (never blind).

## Parts (= commit boundaries, sequential, main thread)

Single session, current model, sequential — parts 2–5 share the popover and
viewModel contract, so no parallel agents.

1. **viewModel core sums** (~80 LOC). In
   `apps/web/src/features/brief/utils/viewModel.ts`: per-group
   `coreAdded`/`coreDeleted` (sum over the already-split `carrierChunks`)
   beside `added`/`deleted`; brief-level `totalCoreAdded`/`totalCoreDeleted`
   beside `totalAdded`/`totalDeleted`. Direct unit tests on the sums
   (pure functions).
2. **Mini-panel popover component** (~150 LOC). Shared by Header + GroupCard
   → lives at their nearest common ancestor under
   `components/BriefScreen/` (placement rule). Exported prop interface
   (component conventions). Portal/fixed, focusable trigger wrapper,
   Escape dismiss, `data-testid` + `data-state` at birth. Content: two
   `dl` rows + caveat line.
3. **Header + details panel** (~80 LOC). `Header.tsx` statsGroup: swap
   adjusted-lines cell for `core lines` / `≈ +…/−…` with the popover
   (brief-scoped numbers). `BriefDetailsPanel.tsx`: add `core lines` row
   (new prop through `Header.tsx`), extend caveat.
4. **GroupCard eyebrow** (~50 LOC). Core-only line with `≈`, popover with
   group-scoped numbers; chunk counts keep their wording but say `core`.
5. **User-visible copy sweep carrier→core** (~100 LOC). Grep user-facing
   strings only — role badges, unreviewed-carrier gate copy, aria labels,
   any tooltip/title text. Identifiers, types, wire values, tests' internal
   fixtures stay `carrier`.
6. **Visual verification** (no code). Run the app (verify skill), screenshot
   header + group card + details panel at ≥1280px and in the 880–1120px band,
   MEASURE alignment, run the impeccable audit + axe on touched surfaces.
   Attach screenshots to the PR (frontend PR requirement).

## Verification gate (before PR)

```sh
pnpm -C apps/web typecheck
pnpm -C apps/web test
pnpm -C apps/web lint
pnpm -C apps/web build
```

Coverage floor rides inside `pnpm test`; new viewModel sums and popover carry
tests. CI is path-filtered — apps/web only; no cross-package contract touched.
