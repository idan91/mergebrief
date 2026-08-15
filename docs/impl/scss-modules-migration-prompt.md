# Handoff prompt — SCSS modules migration (`apps/web`)

> Paste everything below the line to a fresh agent (Sonnet or GPT-5.5). It is self-contained.

---

You are working in the repository at `/Users/idan/Projects/Code/code-review` — a TypeScript
monorepo whose web app, `apps/web`, is built with **Vite + TanStack Start + React 19** in
**strict TypeScript**. Your task is a **CSS architecture migration** of `apps/web`: move all
styling from the single flat global stylesheet `apps/web/src/styles/app.scss` (~2,600 lines)
into a layered global SCSS layer plus **colocated per-component `*.module.scss` files**.

## Authoritative spec
The full plan lives in **`todo.md`** at the repo root (section: "Migrate `apps/web` to SCSS
modules"). Read it first and treat it as the source of truth. It contains the target
architecture, the exact list of components to migrate, the "Modernization requirements"
(all of which are **required**, not optional), and the verification gate.

Also read, as the reference architecture this migration is modelled on, the project at
`/Users/idan/Projects/Code/flexer` — specifically its `styles/` folder (layered `@use`
partials) and a few `components/*/styles.module.scss` files (colocated component modules,
BEM-ish names, `classNames(styles.base, styles[variant])`). The in-repo reference module is
`apps/web/src/components/Callout.module.scss`.

## Required skills (use them — do not improvise around them)
- **`git-eng`**: drive the entire git workflow through this skill — requirements/branching
  decisions, chunked commits, the pre-commit review gate, and final PR creation. Do not run raw
  git outside it. Start by branching off `main` (or `feature/imrpove-fe-code` if PR #7 is not
  yet merged). Commit in small chunks (one component or tight cluster per commit). No
  `Co-Authored-By` and no AI-attribution in commit messages or PR body.
- **`typescript-eng`**: whenever you write or modify **any** TypeScript/TSX (component class
  wiring, `clsx` usage, `data-*` props, vite config, etc.), follow this skill's guidance —
  strict types, no `any` (use `unknown` + narrowing), `satisfies` over `as`, exported prop
  interfaces (not inline), named exports, no `enum`.

## Why this is a redesign (not find/replace)
- Components compose class names at runtime today (`` `${asideClassName} show` ``,
  `` `modal-box ${boxClassName}` ``, `` `resolved ${kind}` ``, `` `concern-${chunk.concern}` ``,
  `` `rev-${revMark}` ``). Hashed CSS-module class names break string composition.
- `app.scss` uses cross-cutting selectors that span components
  (`.split-main .story-group .group-card`, `.chunk.open .chunk-head`).
- Module class renaming means **no byte-diff verification is possible** — appearance must be
  verified visually per component.

## What to do (see `todo.md` for full detail)
1. **Global layer** in `apps/web/src/styles/`: keep `tokens.scss` (CSS custom properties — do
   NOT convert tokens to Sass variables or add a Sass `:export`); add `_functions.scss`,
   `_mixins.scss`, `_shared.scss`, and a single global `base.scss` for resets / `html` / `body`
   / `.scrim` / base `.btn` / page-layout shells (`.main`, `.split-main`, the `.story-group`
   grid) and the a11y blocks (`prefers-reduced-motion`, `prefers-contrast`, `forced-colors`).
   Add `css.preprocessorOptions.scss.loadPaths: ["src/styles"]` to `vite.config.ts` and
   standardize all `@use` paths.
2. **Component layer**: one colocated `<Component>.module.scss` per component, `@use`-ing only
   the partials it needs; keep `var(--token)` for tokens (no import). `import styles from
   "./X.module.scss"` and convert `className="foo"` → `className={styles.foo}`. Add **`clsx`**
   (pinned) for composition where still needed.
3. **Apply ALL "Modernization requirements" from `todo.md` (they are mandatory)**:
   1. `data-*` attribute variants instead of composed class strings (state like open/reviewed/
      rev/concern → `data-state`, `data-reviewed`, `data-rev` + attribute selectors). This is
      the primary mechanism that removes the runtime-class problem.
   2. `color-mix()` for hover/variant color math on `var(--token)` (no Sass color functions).
   3. Cascade `@layer tokens, base, layout, components;` to order global vs component styles.
   4. Fluid sizing with `clamp()`/`min()`/`max()`.
   5. Container queries (`@container`) for component-level responsiveness.
   6. Logical properties (`margin-inline`, `padding-block`, `inset`).
   7. Tiered design tokens (primitive → semantic → component custom properties).
   8. `light-dark()` + `color-scheme`.
   9. Native `:focus-visible` base rule, `@property` typed tokens, and stylelint 16
      (`stylelint-config-standard-scss`) wired into the web lint step.

## Verification gate (every commit — required)
- `pnpm --dir apps/web typecheck` and `pnpm --dir apps/web test` green. The characterization
  suite at `apps/web/src/characterization/briefScreen.test.tsx` MUST stay green — it is the
  behaviour guard; never weaken or skip it.
- Run `prettier --write`/`--check` on changed files.
- **Per-component before/after screenshots** (use the `playwright-cli` skill) against
  `http://localhost:3000/briefs/Idan91-code-review-5_1_10f4acc2` and
  `http://localhost:3000/briefs/Idan91-code-review-5_1_10f4acc2/summary-preview`
  (run `pnpm --dir apps/web dev` first). Compare images and investigate ANY visual change
  before continuing to the next component. Appearance must be preserved exactly.
- SSR smoke: curl those routes, confirm no console errors and key elements render.

## Definition of done
- Every component in `todo.md`'s migration list has a colocated `*.module.scss`; `app.scss` is
  deleted or reduced to the tokens import + the small global base.
- All nine modernization requirements are applied consistently across components.
- typecheck + tests + characterization suite green; screenshots show no visual regressions.
- A PR (via `git-eng`) summarising which components moved, the final state of `app.scss`, and
  attached before/after screenshots of: the brief screen, the receipt drawer, the summary
  preview, and a diff table with the revision overlay enabled.

If anything in `todo.md` conflicts with what you find in the code, trust the code, and note the discrepancy in your PR description (if this is added to an existing PR, add the content accordingly).
