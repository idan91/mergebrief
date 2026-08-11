# packages/i18n — agent notes

The string-catalog boundary. `locales/en.json` is the single source of
truth for user-facing copy; `createI18n()` bakes every shipped catalog into
a ready instance. apps/web binds react-i18next on top; the CLI calls `t()`
bare. This package depends on i18next only — react-i18next stays in
apps/web (the CLI never pulls React).

## Map

**Entry point: `src/index.ts`** — the package's only export
(`package.json` `exports["."]`).

```
locales/      one <id>.json per shipped locale; en.json is source of truth
src/
  index.ts    ENTRY — factory, registry, pseudo, catalog + TranslationKey
  create.ts   createI18n — synchronous init, resources baked in
  locales.ts  LOCALES registry (picker list) + RESOURCES map
  pseudo.ts   dev-only pseudo-locale postProcessor (accent map + ~35% pad)
  types.ts    TranslationKey (dotted key union from en.json) + the
              CustomTypeOptions wiring (typed keys for every consumer)
test/         QA gates (hard-fail mechanical + report-only completeness)
              + factory/pseudo suites; helpers.ts holds the checkers
```

## Invariants (enforced, don't weaken)

- **Key grammar**: semantic dotted camelCase `feature.area.phrase`;
  purpose-prefixed leaves where ambiguous (`ariaLabelClose`). Wire-error
  keys are `errors.<code>` (verbatim kebab-case wire code) and
  generation-failure keys `generationError.<code>` — lookup is
  `"errors." + code`, never a mapping table.
- **Plurals**: i18next `_one`/`_other` suffix keys with mandatory
  `{ count }`; no `_zero` in English (`_other` covers 0; special zero-copy
  is its own key). Composite sentences split — plural core as a keyed
  pair, suffixes as separate keys, composition in code. No ICU.
- **Inline markup rides positional slots**: a sentence wrapping an element
  (`<code>`, a link) is ONE entry with `<0>…</0>` / `<0/>` marking where the
  element sits; the call site passes them through `<Trans components={…}>`.
  Element NAMES never appear in a value — that is what keeps the markup ban
  absolute. Indices run 0..n-1 exactly once each, no nesting, no empty or blank pair.
  The shape this replaces is a fragment pair whose split point sits MID-CLAUSE
  around an element. Shapes that are NOT that and stay split: a whole sentence
  beside another whole sentence (`brief.changes.noRevisionSummary*`); a leading
  label with its own clause (`brief.group.addressedLead` + `addressedBody`);
  and a unit label trailing a value (`brief.group.coreSuffix`) — in none of
  them is an element's position what a translation needs to move.
- **Slots are self-closing (`<0/>`); the element brings its own children.**
  A `<code>` gets its identifier, a link gets its label from its own key
  (`shell.signInWithGithub`). Two rules make this the default rather than the
  paired `<0>…</0>` form: `<Trans>` parses an interpolated `{{param}}` as
  HTML, so `<0>{{cmd}}</0>` renders a bracket-bearing command escaped and
  visible (`pnpm categorize &lt;pr-url&gt;`) and would feed external data to
  an HTML parser; and an empty `<a/>` in a `components` array fails oxlint's
  `jsx-a11y/anchor-has-content`, which cannot see that Trans fills it. Use the
  paired form only for prose that must stay inside the sentence — the gate
  accepts it, nothing ships it today.
- **en.json is the source of truth**; locale files are community-owned.
  The mechanical review bar lives in this package's vitest suite
  (hard-fail: parse, no invented/stale keys, `{{param}}` and slot sets
  match, plural suffixes valid and only on pluralized en bases, no markup
  beyond positional slots, no empty values). Completeness only reports — a
  partial locale ships and falls back through `locale → base-lang → en`.
- **Typed keys**: `types.ts` ships the `CustomTypeOptions` wiring —
  an unknown key fails to compile in every consumer. JSON imports widen
  values to `string`, so `{{param}}` integrity is gate-enforced, not
  compile-enforced.
- **Registry ↔ files**: every `locales/<id>.json` has exactly one
  `LOCALES` row and one `RESOURCES` entry; the suite pins the bijection.
  The pseudo locale has NO file and NO registry row — it exists only as
  the postProcessor.
- **No backend, no detection**: resources are baked in and init is
  synchronous. Locale selection belongs to callers.

## Conventions

Mirrors the sibling packages (root `AGENTS.md`): strict TS, no `enum`, no
bare `as`, named exports, extensionless relative imports.

## Verification

```sh
pnpm -C packages/i18n typecheck
pnpm -C packages/i18n test
pnpm lint                        # repo-root
```
