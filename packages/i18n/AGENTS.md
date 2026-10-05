# packages/i18n — agent notes

The string-catalog boundary. `src/locales/en.json` is the single source of truth for user-facing copy; `createI18n()` bakes every shipped catalog into a ready instance. apps/web binds react-i18next on top; the CLI calls `t()` bare. This package depends on i18next only — react-i18next stays in apps/web (the CLI never pulls React).

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Map

`src/locales/` holds one `<id>.json` per shipped locale; the QA gates live in this package's `test/`. The pseudo locale is a postProcessor (accent map + ~35% pad), dev-only.

## Invariants (enforced, don't weaken)

- **Key grammar**: semantic dotted camelCase `feature.area.phrase`; purpose-prefixed leaves where ambiguous (`ariaLabelComment`). Wire-error keys are `errors.<code>` (verbatim kebab-case wire code) and generation-failure keys `generationError.<code>` — lookup is `"errors." + code`, never a mapping table.
- **Plurals**: i18next `_one`/`_other` suffix keys with mandatory `{ count }`; no `_zero` in English (`_other` covers 0; special zero-copy is its own key). Composite sentences split — plural core as a keyed pair, suffixes as separate keys, composition in code. No ICU.
- **Inline markup rides positional slots**: a sentence wrapping an element (`<code>`, a link) is ONE entry with `<0>…</0>` / `<0/>` marking where the element sits; the call site passes them through `<Trans components={…}>`. Element NAMES never appear in a value — that is what keeps the markup ban absolute. Indices run 0..n-1 exactly once each, no nesting, no empty or blank pair. Slots replace only a fragment pair split MID-CLAUSE around an element. Whole sentences side by side, a leading label with its own clause, and a unit label trailing a value all stay split (`brief.changes.noRevisionSummary*`, `brief.group.addressedLead`/`addressedBody`, `brief.group.coreSuffix`).
- **Slots are self-closing (`<0/>`); the element brings its own children.** A `<code>` gets its identifier, a link its label from its own key (`shell.signInWithGithub`). The paired `<0>…</0>` form is ONLY for prose that must stay inside the sentence: `<Trans>` parses an interpolated `{{param}}` as HTML (a bracket-bearing command renders escaped, and external data would feed an HTML parser), and an empty `<a/>` in a `components` array fails `jsx-a11y/anchor-has-content`.
- **en.json is the source of truth**; locale files are community-owned. The mechanical review bar lives in this package's vitest suite (hard-fail: parse, no invented/stale keys, `{{param}}` and slot sets match, plural suffixes valid and only on pluralized en bases, no markup beyond positional slots, no empty values). Completeness only reports — a partial locale ships and falls back through `locale → base-lang → en`.
- **Typed keys and params**: `types.ts` ships the `CustomTypeOptions` wiring — an unknown key fails to compile, and parameterized calls infer expected replacement names plus formatted value types. JSON imports widen values to `string`, so `catalog.generated.ts` restores literals only for parameterized leaves. Run `pnpm generate:types` after editing catalog parameters; typecheck rejects stale generated output.
- **Registry ↔ files**: every `src/locales/<id>.json` has exactly one `LOCALES` row and one `RESOURCES` entry; the suite pins the bijection. The pseudo locale has NO file and NO registry row — it exists only as the postProcessor.
- **No backend, no detection**: resources are baked in and init is synchronous. Locale selection belongs to callers.
