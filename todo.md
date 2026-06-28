# TODO

## [x] Skip off-screen `DiffTable` render with `content-visibility`

Done. The real bottleneck was the **aggregate layout/paint of many simultaneously-expanded
moderate diffs** (all carrier chunks open by default), not one giant chunk. Fixed with CSS
`content-visibility: auto` on a `.viewport` wrapper per `DiffTable`, plus a data-driven
`contain-intrinsic-block-size` (`--diff-rows` = `chunk.diff.length`, ≈22px/row) so off-screen
diffs reserve roughly their real height and don't thrash the scrollbar. Near-zero JS; `<table>`
markup, index-based anchoring, drag-select, and the characterization suite all untouched.
`DeltaCallout` already portals to `document.body`, so `contain: paint` doesn't affect its fixed
positioning. See `DiffTable.tsx` / `DiffTable.module.scss`.

> Deferred fallback: row-level windowing with `@tanstack/react-virtual` (flatten the
> heterogeneous row list, swap `<table>`→grid or use spacer rows) — only worth it if a
> pathological multi-thousand-line single chunk ever appears, which it currently doesn't.

---

## [ ] Migrate `apps/web` to SCSS modules (global + component layers)

Adopt the SCSS architecture proven in `~/Projects/Code/flexer` (layered global `styles/`
partials via `@use` + colocated `components/X/styles.module.scss`), adapted to this repo's
Vite/TanStack stack and **keeping CSS custom-property tokens** (an improvement over flexer's
compile-time Sass-variable tokens + `:export` hack).

Today everything is in the flat global `apps/web/src/styles/app.scss` (~2.6k lines); only
`styles/tokens.scss` (CSS custom properties) is split out. Reference module already in repo:
`apps/web/src/components/Callout.module.scss`.

### Why this is a redesign, not a find/replace
- Components compose class names at runtime — `` `${asideClassName} show` `` (Drawer),
  `` `modal-box ${boxClassName}` `` (Modal), `` `resolved ${kind}` `` (GroupCard),
  `` `concern-${chunk.concern}` ``/`open`/`reviewed`/`current` (ChunkCard),
  `` `rev-${revMark}` `` + line-kind classes (DiffTable). Hashed module classes break these.
- `app.scss` has cross-cutting selectors spanning components
  (`.split-main .story-group .group-card`, `.chunk.open .chunk-head`).
- No byte-diff verification is possible (modules rename classes) → **per-component
  before/after screenshots** are the gate.

### Target architecture (from flexer, improved)

**Global layer — `apps/web/src/styles/`**
- `tokens.scss` — **keep as-is**: `:root { --token }` CSS custom properties (runtime-themeable,
  no `:export`). The source of truth for colors/spacing/fonts.
- `_functions.scss` — `to-rem`/`to-em`/`get-breakpoint` (plain partials, `_` prefix; not
  `.module` — they export no classes).
- `_mixins.scss` — `flex`, `for-size`/`for-mobile`, `focus-visible`, `disabled-input`, etc.
- `_shared.scss` — `%placeholder` rules consumed via `@extend`.
- `base.scss` (or the shrunk `app.scss`) — the **single global stylesheet** loaded once at the
  root: resets, `html`/`body`, `.scrim`, base `.btn`, the page-layout shells
  (`.main`, `.split-main`, the `.story-group` grid) that genuinely span components, and the
  a11y blocks ported from flexer's `globals.scss` (`prefers-reduced-motion`,
  `prefers-contrast`, `forced-colors`).
- Standardize all `@use` paths and add a Vite Sass load path so modules can
  `@use "styles/mixins"`:
  ```ts
  // vite.config.ts
  css: { preprocessorOptions: { scss: { loadPaths: ["src/styles"] } } }
  ```

**Component layer**
- One `<Component>.module.scss` colocated per component; `@use` only the global partials it
  needs (`@use "styles/mixins" as mixins;` etc.). Keep tokens as `var(--token)` (no import).
- BEM-ish names + `&.modifier` for variants (mirror flexer's `.button` / `&.fill`).
- TSX: `import styles from "./X.module.scss"`, swap `className="foo"` → `className={styles.foo}`.
- Add **`clsx`** (pinned) for composition: `clsx(styles.chunk, expanded && styles.open)`.
- Dynamic/template-literal classes → explicit lookup into `styles`, never interpolated:
  `styles[`rev_${mark}`]`, `styles[`concern_${concern}`]` (rename CSS keys to valid identifiers).

**Components to migrate:** Header, Toolbar, DemoControls, ConcernView, TimelineNavigator,
StoryView, GroupCard, ChunkCard, DiffTable, RevisionGutterCell, DeltaContext, Footer,
Markdown, Modal, Drawer, CommentComposer, CommentThread, MarkdownPreview, ReceiptDrawer,
SummaryPreview, AddressedComments/AddressedDiffComment, BriefPage shell.

### Also consider (flexer parity)
- Wire **stylelint** (BEM naming + property order) into the web lint/CI step.
- Optionally a `:export`-style bridge ONLY if a value is needed in JS — prefer reading
  `getComputedStyle(--token)` over re-introducing `:export`.

### Modernization requirements (REQUIRED — flexer predates most of these)

All of the following are required, not optional. Apply them as part of the migration.

1. **`data-*` attribute variants instead of composed class strings** *(highest-value here)*.
   The hardest part of this migration is runtime class composition. Modern CSS lets the base
   class stay a single stable module class and expresses state via attributes:
   ```tsx
   <article className={styles.chunk} data-state={open ? "open" : "collapsed"}
            data-reviewed={reviewed || undefined} data-rev={revMark}>
   ```
   ```scss
   .chunk { …
     &[data-state="open"] { … }     // replaces `.chunk.open`
     &[data-reviewed] { … }
     &[data-rev="removed"] { … }    // replaces `rev-${mark}`
   }
   ```
   Removes the `styles[`rev_${mark}`]` lookup maps and most `clsx` calls; keeps module scoping.
2. **`color-mix()` for variant/hover math at runtime** instead of Sass `color.adjust()`.
   Flexer must precompute hover/fill colors at build because Sass can't operate on
   `var(--token)`. With custom-property tokens you keep the math in CSS:
   `background: color-mix(in srgb, var(--primary) 90%, black);` — no Sass color funcs needed.
3. **Cascade layers `@layer tokens, base, layout, components;`** to make global-vs-component
   precedence explicit and kill reliance on source order / `!important` — directly tames the
   current cross-cutting-selector problem.
4. **Fluid sizing with `clamp()`/`min()`/`max()`** to shrink the breakpoint-mixin + `to-rem`
   surface (keep `to-rem` only where genuinely needed).
5. **Container queries (`@container`)** for component-level responsiveness (cards, FlexControls
   analog) instead of viewport `@media` — components react to their own width, ideal for the
   split layout.
6. **Logical properties** (`margin-inline`, `padding-block`, `inset`) for RTL/i18n readiness.
7. **Tiered design tokens**: primitive → semantic → component custom properties
   (`--violet-500` → `--color-surface` → `--chunk-bg`) instead of flat `$gray1..3`.
8. **`light-dark()` + `color-scheme`** if theming is ever wanted (tokens already custom props).
9. **Native `:focus-visible` base rule** + `@property` for typed/animatable tokens; modern
   stylelint 16 (`stylelint-config-standard-scss`).

> All nine are required for this migration. #1–#3 remove the core friction (dynamic classes,
> compile-time color math, cross-cutting specificity); #4–#9 bring the rest of the stylesheet up
> to current CSS. Apply each consistently across every component, not just where convenient.

### Verification (required, every commit)
- `pnpm --dir apps/web typecheck` + `pnpm --dir apps/web test` (the characterization suite at
  `src/characterization/briefScreen.test.tsx` must stay green).
- `playwright-cli` before/after screenshots per component against
  `/briefs/Idan91-code-review-5_1_10f4acc2` and `…/summary-preview?mode=author`; diff and
  investigate any visual change before moving on.
- SSR smoke (`pnpm --dir apps/web dev`, curl the routes, no console errors).
- Goal end state: `app.scss` reduced to tokens import + the small global base.

---

## Agent prompt (paste to a fresh agent)

> Migrate `apps/web` styling from the flat global `src/styles/app.scss` to per-component SCSS
> modules, on a new branch off `main` (or `feature/imrpove-fe-code` if PR #7 isn't merged).
>
> Model the architecture on `~/Projects/Code/flexer` (read its `styles/` folder and a couple of
> `components/*/styles.module.scss` first): a layered global `styles/` of `@use` partials plus
> colocated component modules. **Read `todo.md` ("Migrate to SCSS modules") for the full target
> and the why** — this is a redesign, not find/replace. Follow the existing
> `apps/web/src/components/Callout.module.scss` pattern.
>
> Apply ALL of the "Modernization requirements" from `todo.md` (they are required, not
> optional): **#1 data-attribute variants** (express open/reviewed/rev/concern state via `data-*`
> + attribute selectors instead of composed class strings), **#2 `color-mix()`** for
> hover/variant color math on `var(--token)` (no Sass color funcs), **#3 cascade `@layer`**
> (tokens, base, layout, components), **#4 fluid `clamp()`/`min()`/`max()` sizing**,
> **#5 container queries** for component-level responsiveness, **#6 logical properties**
> (`margin-inline`/`padding-block`/`inset`), **#7 tiered tokens** (primitive → semantic →
> component custom properties), **#8 `light-dark()` + `color-scheme`**, and **#9 native
> `:focus-visible` base rule, `@property` typed tokens, and stylelint 16
> (`stylelint-config-standard-scss`)**. Apply each consistently across every component.
>
> Do:
> - Build the global layer in `src/styles/`: keep `tokens.scss` (CSS custom properties — DO NOT
>   convert tokens to Sass variables or add a `:export`), add `_functions.scss`, `_mixins.scss`,
>   `_shared.scss`, and a single global `base.scss` for resets/body/.scrim/base .btn + the
>   page-layout shells (`.main`, `.split-main`, `.story-group` grid) + a11y blocks
>   (prefers-reduced-motion / prefers-contrast / forced-colors). Add
>   `css.preprocessorOptions.scss.loadPaths: ["src/styles"]` to `vite.config.ts` and standardize
>   `@use` paths.
> - Give each component a colocated `<Component>.module.scss` that `@use`s only the partials it
>   needs; keep `var(--token)` for tokens. Convert every static + runtime-composed class to the
>   `styles` object; add `clsx` (pinned) and use explicit `styles[...]` lookup maps for dynamic
>   suffixes (`rev-${mark}`, `concern-${concern}`, `resolved ${kind}`).
> - Preserve behaviour and appearance EXACTLY. No byte-diff is possible (modules rename
>   classes), so verify EACH component with before/after screenshots via the `playwright-cli`
>   skill against `/briefs/Idan91-code-review-5_1_10f4acc2` and
>   `/briefs/Idan91-code-review-5_1_10f4acc2/summary-preview?mode=author`; diff the images and
>   investigate any change before continuing.
> - Small commits, one component (or tight cluster) each. After every commit:
>   `pnpm --dir apps/web typecheck`, `pnpm --dir apps/web test` (characterization suite green),
>   prettier --check on changed files, and the screenshot check. By the end `app.scss` should be
>   gone (or reduced to the tokens import + global base).
> - Optionally wire stylelint (BEM + order) like flexer.
> - TypeScript: strict, no `any`, exported prop interfaces, named exports. Use the `git-eng`
>   skill for git ops; no Co-Authored-By / AI-attribution in commits.
> - Open a PR summarising components moved, final `app.scss` state, and attach before/after
>   screenshots of the brief screen, receipt drawer, summary preview, and a diff table with the
>   revision overlay on.
