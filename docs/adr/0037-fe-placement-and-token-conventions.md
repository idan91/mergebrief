# 0037 — FE placement and token conventions (apps/web)

Status: accepted (2026-07-26). Decided in the BRIEF-44 grill (research
subpage: full apps/web audit + five owner-direction sections); implementation
plan: `docs/plans/brief-44-fe-conventions.md`. Scope: `apps/web` source only —
`data/`, `server/`, `test/`, and `characterization/` are untouched by this
ADR. Repo-wide TS rules stay in the root `CLAUDE.md`; this ADR is the FE
layer on top.

## Context

apps/web grew feature-by-feature (BRIEF-19 through BRIEF-85) with no written
placement convention. The audit found the predictable symptoms: `BriefPage`
as a monolith carrying flow logic that belongs in facade hooks; `src/lib/` as
an unsorted catch-all; 89 triple-deep relative imports (`../../../`); 92 raw
hex values across `.module.scss` files alongside a `tokens.scss` that already
exists but is bypassed; an accidental font-size scale (near-duplicate values
that were never a decision); tests selecting on hashed class names where
data-attrs would survive refactors (the June characterization lesson).

None of this is fixable once by a sweep alone — without a convention, the
next feature regrows it. The convention must also be **agent-legible**: most
code here is written by agents, so "where does a new file go" needs a
deterministic procedure, not taste, and rules must be lint-enforced wherever
the existing toolchain can express them. In deep-module terms: each component
folder is a module whose interface is its exported component + props; its
co-located hooks/utils/styles are implementation, and the placement rules
below exist to keep them implementation — visible to descendants that are
part of the same module, never a lateral import surface.

## Considered Options

- **Layering:** a `pages/` layer between routes and features · routes as
  glue over `features/<domain>/` (chosen) — today's routes do not map 1:1
  onto features, so a pages layer would be a third name for one of the other
  two layers.
- **Shared-code placement:** global-first (`src/utils` grows by default) ·
  per-surface rules (one rule for hooks, another for styles) · **one subtree
  ownership rule across all four surfaces (chosen)**.
- **Enforcement tooling:** adopt ESLint/Biome for richer rules · **extend
  existing tools only — stylelint in apps/web, oxlint at root (chosen)** —
  a second linter is a permanent tax for a handful of rules, and what the
  existing tools can't express can be a guard test or honest prose.
- **Typed CSS modules:** build-time d.ts codegen · **editor-only
  `typescript-plugin-css-modules` (chosen)** — codegen adds a build step and
  churn for a bug class the data-attr + plugin combination already narrows.
- **State styling hooks:** toggled classes · **data attributes (chosen)** —
  attributes give tests and CSS one stable, hash-free contract.

## Decision

### 1. Layers

No pages layer. Route files are glue only: data loading + composition,
nothing else. `features/<domain>/` is the domain layer — a feature root
holds flat logic files (store, queries, derivations) with tests adjacent;
`components/` inside it is the feature's UI subtree, folder-per-component.
The global layer is `src/components/`, `src/hooks/`, `src/utils/` (renamed
from `lib/`), and `src/styles/`.

### 2. Subtree ownership — one rule, four surfaces

One rule governs components, hooks, utils, and styles alike:

- A file co-located under a component (its `utils.ts`, hooks, partials,
  styles) is **owned by that subtree**. Descendants may import an ancestor's
  co-located files.
- **Lateral imports — reaching into a subtree you are not inside — are
  forbidden**, and an attempted lateral import is the promotion tripwire:
  it means the file has outgrown its owner.
- Promotion target is the **nearest common ancestor** of all consumers
  (a shared parent component folder, then the feature root, then global).
  Global (`src/hooks`, `src/utils`, `src/components`) is the last resort,
  not the default.
- **Dependency-direction cap:** anything that touches a feature's store or
  queries can never sit above that feature — feature knowledge must not
  leak into shared layers, however many consumers appear.

The procedure for placing a new file is therefore deterministic: co-locate
with its single consumer; on the second consumer, promote to their nearest
common ancestor; stop promoting at the layer the dependency cap allows.

### 3. Inline vs utils

Functions defined inside a component are **closure-dependent only** (they
read props/state/refs). Closure-free logic — transformations, formatting,
derivations — extracts to a co-located `<Component>/utils.ts` so it is
unit-testable directly, without rendering. Global utils live in
`src/utils/<type>.ts` per-type files (string, number, …); a new type file
must start with **2+ functions serving 2+ consumers** — no speculative
single-function files.

### 4. Feature-root organization

Feature roots are flat by default. A cluster of **≥4 related files** earns a
topic folder; today only `features/brief/comparison/` qualifies. The
threshold is provisional (see revisit triggers).

### 5. Token bar

**Zero raw values in `.module.scss` for colors, font-sizes, border-radii,
and box-shadows** — every such value goes through `var(...)` or a mixin.

*Amended 2026-07-26 (owner call, during implementation).* The original
two-phase plan (faithful value-named tokens first, semantic collapse later)
was superseded: value-named tokens (`--font-size-13`, `--radius-8`,
`--color-surface-01`) are banned as scaffolding waste. Tokens exist only for
the deliberate design-system scale:

- **Type:** semantic steps (`--font-size-xs` … `--font-size-3xl`, `md` =
  body) plus em steps for parent-relative contexts.
- **Radius / shadow:** small semantic sets (`--radius-xs/sm/md/lg/pill/
  circle`; `--shadow-elevation-sm/md/lg` + special cases).
- **Color:** small numbered families (`--color-surface-N`, `--color-text-N`,
  `--color-outline-N`) plus role tokens (accent, warning, negative, …).

Values that do not fit the scale stay as **raw values at the use site**
with a line-scoped stylelint disable and a `TODO(BRIEF-44)` consolidation
note — unless they earn locality: a component-local token with a one-line
justification comment, never a global addition. The global scale stays a
decision surface, not a dumping ground. Scale changes are visual decisions
and get owner screenshot review. Spacing is out of scope for now (revisit
trigger below); rem-vs-px unit policy is BRIEF-84's scope — coordinate,
don't duplicate.

### 6. Token vocabulary

The semantic `--color-*` family is canonical. Legacy short names (`--bg`,
`--line`, …) become aliases of the canonical tokens and retire file-by-file
as the sweep touches each module — no big-bang rename, no dual-source
drift (aliases point at canon, never carry their own values).

### 7. Data attributes

- `data-testid` is the test-selection contract — tests never select on
  hashed class names or copy text for structural assertions.
- `data-state` / `data-variant` are the state/variant styling hooks — CSS
  targets attributes, not toggled classes.
- Extracted components adopt both **at birth**: extraction PRs are the
  cheapest moment to install the contract.

### 8. Enforcement — existing tools, honestly scoped

Extend existing tools only (stylelint in apps/web, oxlint at root — no
ESLint, no Biome):

- **stylelint** `declaration-property-value-allowed-list` enforces the token
  bar per value family (colors, font-sizes, radii, shadows).
- **oxlint** carries whatever it can express of the TS standards:
  `typescript/no-explicit-any`, `typescript/consistent-type-assertions`
  with `assertionStyle: "never"` (the "no bare `as`" rule; `as const` and
  `satisfies` are untouched), `import/no-default-export` (named exports,
  with the framework config/entry files carved out per path),
  `oxc/no-const-enum`, `no-console` re-tightened to ALL levels over ADR
  0034's server paths, and `import/no-cycle`.
  Landed in BRIEF-44 PR 6; each rule was verified red on a violation probe
  before landing.
- **Test-as-enforcement:** a guard test parses every `var(--x)` usage in
  `.module.scss` and asserts the token is defined in `tokens.scss` or
  locally in the same module — an undefined var is invisible at build time
  and silently renders as the fallback (or nothing); the test makes it red.
- **Editor-level** `typescript-plugin-css-modules` for classname
  autocomplete/checking; no build-time d.ts codegen.

What lint cannot express stays prose, listed honestly: the subtree
ownership/promotion procedure (2), the inline-vs-utils split (3), the
topic-folder threshold (4), earned-oddity justifications (5), and data-attr
adoption at birth (7). These live in this ADR and, compressed, in
`apps/web/AGENTS.md`. Two more joined the list when the rules were built
(oxlint 1.72): the **plain-`enum` ban** — oxlint ships neither a `no-enum`
rule nor `no-restricted-syntax`, so only `const enum` is caught — and the
**lateral-import restriction**, which needs a per-file *relative* path
predicate (`no lateral import outside MY subtree`); oxlint's overrides only
select which rules apply to a file, and `import/no-restricted-paths` does not
exist, so the rule cannot be stated. Both remain prose + review.

### 9. Path alias

`@web/` aliases the app source root. The 89 triple-deep relative imports are
rewritten once, during the structure-motion PR — alias before moves, so
paths churn once.

## Why This Way

One ownership rule across all four surfaces means an agent (or human) asks
one question — "who consumes this?" — and placement falls out mechanically;
per-surface rules would each need their own tripwire and their own drift.
The lateral-import ban doubles as the promotion signal, so the convention is
self-correcting rather than policed. Faithful-first tokenization keeps the
mechanical sweep reviewable as a no-op and quarantines every visual decision
in one screenshot-gated PR. And capping enforcement at existing tools keeps
the convention honest: rules are either mechanically checked or explicitly
listed as prose, never assumed to be enforced when they aren't.

## Consequences

- `apps/web/AGENTS.md` gains a lean placement entry (the non-inferable
  rules + pointer here); lint-enforced rules stay out of prose there.
- `src/lib/` → `src/utils/`; `@web/` alias lands with the structure-motion
  PR; `features/brief/comparison/` becomes the first topic folder.
- stylelint config, oxlint rules, and the var-defined guard test land per
  the BRIEF-44 PR spine; the sweep precedes the BriefPage split so extracted
  components are born under the token/lint regime.
- The BriefPage split (plan decision 11) executes under these rules:
  `BriefPage/` (route wrapper) · `BriefView/` (data plumbing) ·
  `BriefScreen/` (layout + wiring) with five facade hooks + `utils.ts`;
  `useLatestRef` promotes to `src/hooks/` (owner call: a feature-agnostic
  generic React utility with no feature knowledge — the dependency cap is
  vacuously satisfied, and generic hooks live global); `useChunkScroller` stays with the reading-session
  hook (single consumer — co-location holds).
- BRIEF-84 (px→rem) executes after the token sweeps, against token
  definitions only.

## Revisit Triggers

- **Topic-folder threshold** (≥4 files) — reassess after the first
  structural PR (BRIEF-44 PR 4).
- **Spacing token scale** — when a spacing-related bug or a design pass
  warrants it; not before.
- **Build-enforced typed CSS modules** — a wrong-classname bug shipping past
  the data-attr + editor-plugin combination.
- **pages/ layer** — routes stabilizing 1:1 with features long-term.
