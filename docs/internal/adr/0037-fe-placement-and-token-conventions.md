# 0037: FE placement and token conventions (apps/web)

Status: amended (see Amendments)
Date: 2026-07-26

Decided in a grill (research
subpage: full apps/web audit + five owner-direction sections). Scope: `apps/web` source only —
`data/`, `server/`, `test/`, and `characterization/` are untouched by this
ADR. Repo-wide TS rules stay in the root `CLAUDE.md`; this ADR is the FE
layer on top.

## Context

apps/web grew feature-by-feature with no written
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
  existing tools can't express can be a guard test or honest text.
  (amended, see Amendments)
- **Typed CSS modules:** build-time d.ts codegen · **editor-only
  `typescript-plugin-css-modules` (chosen)** — codegen adds a build step and
  churn for a bug class the data-attr + plugin combination already narrows.
- **State styling hooks:** toggled classes · **data attributes (chosen)** —
  attributes give tests and CSS one stable, hash-free contract.

## Decision

### 1. Layers

No pages layer. Route files are glue only: data loading + composition,
nothing else. `features/<domain>/` is the domain layer; the global layer is
`src/components/`, `src/hooks/`, `src/utils/` (renamed from `lib/`), and
`src/styles/`. (amended, see Amendments: the entry-point and barrel rules
were added on 2026-07-26, and placement is now owned by the rules files.)

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
single-function files. (amended, see Amendments: global utils are named by
mechanism now.)

### 4. Feature-root organization

(rewritten 2026-07-26, see Amendments; placement is now owned by the rules
files.) A feature root holds the entry (`index.tsx`),
`types.ts`, and visible support categories — `components/` (all UI below
the entry), `hooks/`, `utils/` (derivations, parsers, fixtures —
`validation` and `fixtures` are utils), `server/` (server functions +
server-only IO), and topic folders like `comparison/`. The old
≥4-related-files threshold is replaced by **a category earns a folder when
it clarifies**. A file may stay flat at the feature root only with an
explicit reason (`types.ts` by convention; brief's `queries.ts` because it
touches `server/` and must stay out of the barrels); a generic name with no
domain cue (`singleFlight`) is a defect — co-locate it with its consumer or
fold it into a category.

### 5. Token bar

**Zero raw values in `.module.scss` for colors, font-sizes, border-radii,
and box-shadows** — every such value goes through `var(...)` or a mixin.
(amended, see Amendments: the scale is semantic-only, decided 2026-07-26.)

Values that do not fit the scale stay as **raw values at the use site**
with a line-scoped stylelint disable and a `TODO` consolidation
note — unless they earn locality: a component-local token with a one-line
justification comment, never a global addition. The global scale stays a
decision surface, not a dumping ground. Scale changes are visual decisions
and get owner screenshot review. Spacing is out of scope for now (revisit
trigger below); rem-vs-px unit policy is the px-to-rem ticket's scope — coordinate,
don't duplicate.

### 6. Token vocabulary

The semantic `--color-*` family is canonical. Legacy short names (`--bg`,
`--line`, …) become aliases of the canonical tokens and retire file-by-file
as the sweep touches each module — no big-bang rename, no dual-source
drift (aliases point at canon, never carry their own values). The retirement
is complete: no legacy alias is defined or used in tracked scss.

### 7. Data attributes

- `data-testid` is the test-selection contract — tests never select on
  hashed class names or copy text for structural assertions.
- `data-state` / `data-variant` are the state/variant styling hooks — CSS
  targets attributes, not toggled classes.
- Extracted components adopt both **at birth**: extraction PRs are the
  cheapest moment to install the contract.

### 8. Enforcement — existing tools, honestly scoped

Extend existing tools only (stylelint in apps/web, oxlint at root — no
ESLint, no Biome) (amended, see Amendments):

- **stylelint** `declaration-property-value-allowed-list` enforces the token
  bar per value family (colors, font-sizes, radii, shadows).
- **oxlint** carries whatever it can express of the TS standards:
  `typescript/no-explicit-any`, `typescript/consistent-type-assertions`
  with `assertionStyle: "never"` (the "no bare `as`" rule; `as const` and
  `satisfies` are untouched), `import/no-default-export` (named exports,
  with the framework config/entry files carved out per path),
  `oxc/no-const-enum`, `no-console` re-tightened to ALL levels over ADR
  0034's server paths, and `import/no-cycle`.
  Landed in the build stack; each rule was verified red on a violation probe
  before landing.
- **Test-as-enforcement:** a guard test parses every `var(--x)` usage in
  `.module.scss` and asserts the token is defined in `tokens.scss` or
  locally in the same module — an undefined var is invisible at build time
  and silently renders as the fallback (or nothing); the test makes it red.
- **Editor-level** `typescript-plugin-css-modules` for classname
  autocomplete/checking; no build-time d.ts codegen.

What lint cannot express stays text, listed honestly: the subtree
ownership/promotion procedure (2), the inline-vs-utils split (3), the
topic-folder threshold (4), earned-oddity justifications (5), and data-attr
adoption at birth (7). These live in this ADR and, compressed, in
`apps/web/AGENTS.md`. Two more joined the list when the rules were built:
the **plain-`enum` ban** — oxlint shipped neither a `no-enum`
rule nor `no-restricted-syntax`, so only `const enum` was caught — and the
**lateral-import restriction**, which needs a per-file _relative_ path
predicate (`no lateral import outside MY subtree`); oxlint's overrides only
select which rules apply to a file, and `import/no-restricted-paths` does not
exist, so the rule cannot be stated. Both remained text + review (amended,
see Amendments: both are machine-checked now).

### 9. Path alias

`@web/` aliases the app source root. The 89 triple-deep relative imports are
rewritten once, during the structure-motion PR — alias before moves, so
paths churn once.

### 10. Heading levels

Added 2026-08-29. The type scale decides how big a heading is;
this decides which heading it is. The two were tangled: five modals reached
for `h3` because the Modal shell sized a bare `h3` selector, which is a tag
selector doing size work.

1. `h1` names what the screen is showing. Exactly one per screen — usually
   the page title; on a screen whose content is replaced by a state or error
   card, that card's heading is the `h1`.
2. `h2` is a top-level section of the screen.
3. Overlay content is its own outline, rooted at `h2`, never `h1`. A dialog
   does not replace the screen, so it must not claim the screen's `h1`.
4. A level follows the nearest ancestor heading. No skips.
5. A tag is chosen by document structure, never to get a size. A component
   that wants a different size pins one in its own module.

These govern headings the app itself authors. Markdown authored by a user or
a model and rendered through `components/Markdown` keeps its fixed
`h1`→`h3` / `h2`→`h4` demotion instead: that content is embedded at a
different depth by every call site, so its levels cannot follow an ancestor
the renderer never sees, and the demotion exists to stop authored content
injecting a second `h1` into the outline.

Nothing here is machine-checkable — `eslint-plugin-jsx-a11y` ships no
heading-level rule — so this is a reviewer-held convention, like the
conditional-spread ban. The enforcement that IS available is structural: a
shared shell styles headings level-agnostically
(`:where(h1, h2, h3, h4, h5, h6)`), so it can never again be the reason a
component picks a level. Because `:where()` contributes no specificity, a
component that pins its own heading keeps it, and authored markdown rendered
inside a dialog now keeps its own scale instead of inheriting the shell's.

## Why This Way

One ownership rule across all four surfaces means an agent (or human) asks
one question — "who consumes this?" — and placement falls out mechanically;
per-surface rules would each need their own tripwire and their own drift.
The lateral-import ban doubles as the promotion signal, so the convention is
self-correcting rather than policed. Faithful-first tokenization keeps the
mechanical sweep reviewable as a no-op and quarantines every visual decision
in one screenshot-gated PR. And capping enforcement at existing tools keeps
the convention honest: rules are either mechanically checked or explicitly
listed as text, never assumed to be enforced when they aren't.

## Consequences

- `apps/web/AGENTS.md` gains a lean placement entry (the non-inferable
  rules + pointer here); lint-enforced rules stay out of the text there.
- `src/lib/` → `src/utils/`; `@web/` alias lands with the structure-motion
  PR; `features/brief/model/comparison/` becomes the first topic folder.
- stylelint config, oxlint rules, and the var-defined guard test land per
  the build stack's PR spine; the sweep precedes the BriefPage split so extracted
  components are born under the token/lint regime.
- The BriefPage split (plan decision 11) executes under these rules:
  `BriefPage/` (route wrapper) · `BriefView/` (data plumbing) ·
  `BriefScreen/` (layout + wiring) with five facade hooks + `utils.ts`;
  `useLatestRef` promotes to `src/hooks/` (owner call: a feature-agnostic
  generic React utility with no feature knowledge — the dependency cap is
  vacuously satisfied, and generic hooks live global); `useChunkScroller` stays with the reading-session
  hook (single consumer — co-location holds). This is history: today
  `BriefPage` is the feature entry in `apps/web/src/features/brief/index.tsx`,
  `BriefView` lives under `apps/web/src/features/brief/ui/components/BriefView`,
  no `BriefScreen` or `useChunkScroller` exists, and `useLatestRef` holds in
  `apps/web/src/hooks/`.
- The px→rem conversion executes after the token sweeps, against token
  definitions only. (amended, see Amendments: the 2026-08-03 unit taxonomy.)

## Revisit Triggers

- **Topic-folder threshold** (≥4 files) — reassess after the first
  structural PR. (superseded 2026-07-26, see Amendments)
- **Spacing token scale** — when a spacing-related bug or a design pass
  warrants it; not before.
- **Build-enforced typed CSS modules** — a wrong-classname bug shipping past
  the data-attr + editor-plugin combination.
- **pages/ layer** — routes stabilizing 1:1 with features long-term.
- **Machine-checked heading levels** (decision 10) — a linter shipping a
  heading-level rule the existing toolchain can express, or a level regression
  reaching production past review.

## Amendments

### 2026-07-26: Every folder shows its entry and its support categories

Owner ruling, repo-wide, superseding flat-by-default wherever the two
conflict. Every folder must answer at a glance: (1) what is the main entry
point or component, and (2) everything else must be visibly a support
category (subcomponents, `utils/`, `hooks/`, `types.ts` and kin). A file
sitting loose without an obvious category is a defect. A feature's entry is
`index.tsx` at the feature root: the entry component's own JSX when it carries
no co-located support files, otherwise a curated re-export of the entry
component(s). Inside `components/`, every component folder nests under its
owning component, at the nearest common ancestor of its consumers, the
subtree ownership of decision 2 made visible in the tree. The ownership rule
itself (descendants import ancestors, lateral forbidden, NCA promotion,
dependency cap) is unchanged. Decision 4 was rewritten to this shape, and the
≥4-files topic-folder threshold gave way to "a category earns a folder when it
clarifies".

Barrels are entry-level only, which narrowly reverses the prior no-barrels
stance: the feature `index.tsx`, plus a folder `index.ts` where it clarifies
outside imports (`utils/`). No per-component barrels. Entry barrels are
curated and follow two hard rules: (a) they never re-export anything that
touches server-only code, because a server edge through the barrel puts
server-only code on the client graph and fails the import-protection build
(brief's `queries.ts` stays out of the barrels for that reason); (b) they
exist for outside consumers only, so files inside the feature import their
targets directly, never their own feature's index (`import/no-cycle` would
flag the loop). Cross-feature component imports go through the target
feature's entry; logic modules and `session/`-style state stayed direct file
imports (tightened on 2026-10-20, below).

### 2026-07-26: The token scale is semantic only

Owner call during implementation. The original two-phase plan (faithful
value-named tokens first, semantic collapse later) is superseded: value-named
tokens (`--font-size-13`, `--radius-8`, `--color-surface-01`) are banned as
scaffolding waste. Tokens exist only for the deliberate design-system scale
(`apps/web/src/styles/tokens.scss`): semantic type steps (`--font-size-xs`
through `--font-size-4xl` plus `display`, `md` = body); small semantic radius
and shadow sets (`--radius-xs/sm/chip/md/panel/lg/pill/circle`;
`--shadow-elevation-md/lg` plus named special cases); small numbered color
families (`--color-surface-N`, `--color-text-N`, `--color-outline-N`) plus
role tokens (accent, warning, negative and kin).

### 2026-07-31: The entry rule reaches packages

Decision 1's entry-point rule extends to `packages/*` trees: a package entry
is `src/index.ts`, a curated barrel renamed from the historical `lib.ts`
(ecosystem-convention survey in the package-entry ticket), and `types.ts`
stays flat by convention. `index.tsx` feature barrels and everything else in
this record remain apps/web-scoped. The rule is recorded in the repo-wide
`AGENTS.md`, which owns it; the "≤ ~5 domain-cued loose files" cap this
amendment first carried is not part of that rule and was never enforced
(`packages/contract/src` holds twenty loose files today).

### 2026-08-03: Units, rem for text and px for chrome

Owner-expanded px-to-rem scope. The unit taxonomy is decided and enforced;
"the px→rem conversion runs against token definitions only" is superseded.
rem, always via `functions.to-rem(<px>)` so the px design value stays
readable in source and compiles exact at the 16px root: `font-size`; all
spacing rhythm (`margin*`, `padding*`, `gap`; stylelint bans raw px on these);
text-coupled sizing (touch-target min-heights, text and panel measure caps,
menu and dialog widths, line-number gutters); and spacing-like insets
(dropdown gap offsets, `text-indent`, `text-underline-offset`). px, chrome
that never scales: border widths and hairlines, `outline`, radii, shadows,
blur, icon boxes and decorative geometry (dots, bars, rails, toggles, avatars,
spinners), the runtime-measured `--top-bar-h` cluster, grid scaffold tracks,
transforms, and media and container-query breakpoints (a possible later em
pass is its own decision). Sizing stays a judgment call, no lint; ambiguity
resolves to px.

### 2026-09-25: A component folder's entry is index.tsx

Decision 1's entry rule extends to every component folder. A folder's entry is
`index.tsx`, never a file named after the folder (`Menu/index.tsx`, not
`Menu/Menu.tsx`); the test and the stylesheet keep the component name
(`Menu.test.tsx`, `Menu.module.scss`), and support stays `types.ts` /
`consts.ts` / `utils.ts`, imported one segment below the folder
(`components/Menu/types`). The `Folder/Folder.tsx` shape, which made every
import spell the name twice, is retired. "No per-component barrels" still
holds: the entry is the component's own file, not a re-export of it; a curated
re-export entry exists only at a feature root. Non-React folders follow the
same rule: a file named after its folder is either that folder's `index.ts` or
takes a name for what it owns (`diff/file-diff.ts`, `comparison/runs.ts`);
tests keep mirroring the file they test.

### 2026-10-20: The rules files own placement; this record keeps the FE-only decisions

Placement, support-file names, casing, the folder-name ban, package entries
and the feature import depth are owned by root `AGENTS.md` ("File shape",
"Imports and exports") and `apps/web/AGENTS.md` ("Placement and styling").
Read them for the live rules; the placement half of this record (decisions 1
to 4, 9, and the 2026-07-26, 2026-07-31 and 2026-09-25 entries) is history
where the two differ. Three of those differences are decisions in their own
right: a cross-feature import reaches a feature only through its index or one
segment below it, `session/`-style state included
(`WEB_FEATURE_PUBLIC_SHAPES` in `.dependency-cruiser.cjs`); the Brief feature
is two layers, `model/` and `ui/`, with `test-utils/` as a feature-root
category, each edge gated by a `web-*` dependency-cruiser rule; and flat
feature-root files (`queries.ts`, `schemas.ts`, domain-named modules) and
mechanism-named global utils (`apps/web/src/utils/`) are the default, so
decision 3's per-type `src/utils/<type>.ts` rule and its 2+2 threshold no
longer apply. What stays unique to this record: the token bar and vocabulary
(5, 6), data attributes (7), heading levels (10), the unit taxonomy, and the
subtree ownership procedure (2) as the rationale behind the gated edges.

### 2026-10-20: No feature server folder

apps/web runs no server functions for data. `createServerFn` is banned in
`apps/web/src` (`no-restricted-imports` in `.oxlintrc.json`), no feature
carries a `server/` folder, and `apps/web/src/server/` is app-wide
infrastructure only (env, logger, API transport, health). A read or write the
app needs is an `apps/api` route reached through `data/request`. Decision 4's
`server/` category and the barrel rule's `server/` edge describe a surface
that no longer exists; the barrel rule's substance (nothing server-only on
the client graph) stands.

### 2026-10-20: Enforcement grew past the existing tools

The "extend existing tools only" verdict and decision 8's honest list are out
of date. Two gating tools joined: dependency-cruiser (`.dependency-cruiser.cjs`,
inside `pnpm lint`, unsuppressed) and the house oxlint plugin
(`tools/oxlint-plugin-house`, loaded by `.oxlintrc.json`). With them the
plain-`enum` ban is `house/no-enum` at error, the cross-feature and
global-never-imports-features edges are the `web-*` dependency-cruiser rules,
and the barrel policy is `house/no-re-export`. The ESLint and Biome rejection
stands (ADR 0038 records oxlint as the only linter). Still text and review:
per-component lateral imports inside one feature, the inline-vs-utils split,
earned-oddity justifications, data-attr adoption at birth, and heading
levels. Off-scale raw values carry a stylelint disable with a
`-- <reason>` suffix; a ticket id in a `TODO` is banned in tracked files.
