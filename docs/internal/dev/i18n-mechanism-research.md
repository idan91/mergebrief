# i18n mechanism research (BRIEF-175)

Primary-source survey of how comparable OSS TS/React apps ship i18n, and a
candidate comparison for this repo's constraints: a shared catalog package
consumed by both the Vite/TanStack Start web app and a single-file tsup CLI
bundle; strict TS with typed keys desired; lint-enforced string
externalization; English-only v1 with community translators later; no hosted
infra of our own.

All sources fetched 2026-08-11 from official docs, GitHub source files, the
npm registry, and bundlephobia. Where a claim could not be verified from a
primary source it is marked "unverified".

## Part 1 — What comparable OSS apps actually ship

| App | Mechanism | Catalog format | Key scheme | Typed keys | Literal-string lint | Translator pipeline |
| --- | --- | --- | --- | --- | --- | --- |
| Cal.com | next-i18next / i18next | flat JSON per locale | semantic snake_case | no | no (only `i18n-unused`) | Lingo.dev AI pipeline, bot PRs |
| Outline | i18next + react-i18next + i18next-parser | JSON per locale | natural-language English keys | no | no | Crowdin; manual translation PRs auto-closed |
| Mattermost | react-intl (FormatJS) | flat JSON per locale | semantic dotted ids | no (CI extract-check) | eslint-plugin-formatjs | Weblate bot; CI blocks non-bot catalog edits |
| Sentry | in-house gettext wrapper (Jed) | gettext PO/MO | natural-language msgids | no | no | Transifex (`.tx/config`) |
| Plausible | none — no frontend or backend i18n at all | — | — | — | — | — |
| Excalidraw | in-house (~1 file) | JSON per locale | semantic nested camelCase | **yes** (`NestedKeyOf<typeof en.json>`) | no | Crowdin only; direct PRs refused |
| Grafana | i18next via `@grafana/i18n` wrapper | i18next JSON | semantic dotted `feature.area.phrase` + inline English defaults | no | **yes** — own `no-untranslated-strings` ESLint rule | Crowdin only; locale-file PRs rejected |
| Documenso | Lingui v5 | gettext PO | natural-language msgids (macro-extracted) | n/a (no keys; `compile --strict` in CI) | no (Biome, no lingui lint) | raw GitHub PRs; Crowdin + AI backfill |

Cross-cutting observations:

- Only Excalidraw ships compile-time typed keys — via a ~100-line in-house
  `t()` typed against the imported English JSON, not via a library.
- Only Grafana lint-enforces externalization, and it wrote its own rule.
- Every app with real translations treats non-English catalogs as
  machine-managed artifacts: Outline auto-closes manual translation PRs,
  Mattermost CI hard-fails non-Weblate edits, Grafana and Excalidraw refuse
  direct locale-file PRs. Documenso is the exception (PR-based), backstopped
  by Crowdin + AI.
- i18next (3 of 8) and JSON catalogs (5 of 8) are the plurality choice.

### Cal.com (`calcom/cal.com`, branch `main`)

- Mechanism: `i18next`, `next-i18next`, `react-i18next` in
  [apps/web/package.json](https://github.com/calcom/cal.com/blob/main/apps/web/package.json);
  a dedicated workspace package
  [packages/i18n/package.json](https://github.com/calcom/cal.com/blob/main/packages/i18n/package.json)
  with config at
  [packages/i18n/next-i18next.config.js](https://github.com/calcom/cal.com/blob/main/packages/i18n/next-i18next.config.js)
  (`localePath` resolved into the package — the shared-package layout this
  repo also needs).
- Catalog: flat JSON, one `common.json` per locale —
  [packages/i18n/locales/en/common.json](https://github.com/calcom/cal.com/blob/main/packages/i18n/locales/en/common.json).
  Keys: semantic snake_case (`"apply_to_all"`, `"identity_provider"`,
  `"accept_invitation"`).
- Typed keys: none (no `CustomTypeOptions` anywhere in the repo).
- Lint: no literal-string rule; `i18n-unused` devDep only catches
  unused/missing catalog keys
  ([root package.json](https://github.com/calcom/cal.com/blob/main/package.json)).
- Translators: no Crowdin. Machine translation via the hosted Lingo.dev
  service — [i18n.json](https://github.com/calcom/cal.com/blob/main/i18n.json)
  (36 target locales) plus CI workflow
  [.github/workflows/i18n.yml](https://github.com/calcom/cal.com/blob/main/.github/workflows/i18n.yml)
  running the `lingodotdev` action with an API key, auto-PRing translations.
  A human-translator flow is not documented in-repo (unverified).
- Files inspected: `apps/web/package.json`, `packages/i18n/package.json`,
  `packages/i18n/next-i18next.config.js`,
  `packages/i18n/locales/en/common.json`, `i18n.json`,
  `.github/workflows/i18n.yml`, `CONTRIBUTING.md`, root `package.json`.

### Outline (`outline/outline`, branch `main`)

- Mechanism: `i18next`, `react-i18next`, `i18next-http-backend` (client),
  `i18next-fs-backend` (server), `i18next-parser` for extraction —
  [package.json](https://github.com/outline/outline/blob/main/package.json).
  Client init `app/utils/i18n.ts` (`keySeparator: false`,
  `returnNull: false`); server init `server/utils/i18n.ts`.
- Catalog: JSON per locale —
  [shared/i18n/locales/en_US/translation.json](https://github.com/outline/outline/blob/main/shared/i18n/locales/en_US/translation.json).
  Keys are the English copy itself (`"New API key"`, `"Revoke"`).
- Typed keys: none —
  [app/typings/i18next.d.ts](https://github.com/outline/outline/blob/main/app/typings/i18next.d.ts)
  declares only `returnNull: false`, no typed `resources`.
- Lint: none; enforcement is social ("PRs accepted for wrapping English
  strings … not previously externalized").
- Translators: Crowdin at translate.getoutline.com —
  [docs/TRANSLATION.md](https://github.com/outline/outline/blob/main/docs/TRANSLATION.md);
  [shared/i18n/README.md](https://github.com/outline/outline/blob/main/shared/i18n/README.md)
  says locale files are machine-generated, do not edit; a workflow
  auto-closes manual translation PRs.
- Files inspected: `package.json`, `shared/i18n/index.ts`,
  `shared/i18n/README.md`, `shared/i18n/locales/en_US/translation.json`,
  `app/utils/i18n.ts`, `app/typings/i18next.d.ts`, `docs/TRANSLATION.md`.

### Mattermost webapp (`mattermost/mattermost`, branch `master`)

- Mechanism: react-intl —
  [webapp/channels/package.json](https://github.com/mattermost/mattermost/blob/master/webapp/channels/package.json)
  (dep `react-intl`, devDep `eslint-plugin-formatjs`; scripts `i18n-extract`,
  `i18n-extract:check`). Provider in
  `webapp/channels/src/components/intl_provider/intl_provider.tsx` lazy-loads
  locale JSON by URL.
- Catalog: flat JSON —
  [webapp/channels/src/i18n/en.json](https://github.com/mattermost/mattermost/blob/master/webapp/channels/src/i18n/en.json).
  Keys: semantic dotted (`"about.version"`, `"activity_log.browser"`,
  `"admin.cluster.enableTitle"`).
- Typed keys: none; drift between source and `en.json` is caught by the CI
  `i18n-extract:check` script, not the type system.
- Lint: `eslint-plugin-formatjs` in devDeps; whether the
  literal-string rule specifically is enabled was not readable from the
  eslint config (unverified).
- Translators: Weblate at translate.mattermost.com —
  [.github/workflows/i18n-ci-template.yml](https://github.com/mattermost/mattermost/blob/master/.github/workflows/i18n-ci-template.yml)
  fails PRs from any author other than the `weblate` bot that touch
  non-English catalogs; in-product link to the translation server in
  [manage_languages.tsx](https://github.com/mattermost/mattermost/blob/master/webapp/channels/src/components/user_settings/display/manage_languages/manage_languages.tsx).
- Files inspected: `webapp/channels/package.json`,
  `webapp/channels/src/i18n/en.json`, `webapp/channels/src/i18n/i18n.ts`,
  `webapp/channels/src/components/intl_provider/intl_provider.tsx`,
  `.github/workflows/i18n-ci-template.yml`.

### Sentry (`getsentry/sentry`, branch `master`)

- Mechanism: in-house gettext wrapper over Jed —
  [package.json](https://github.com/getsentry/sentry/blob/master/package.json)
  (`jed`, `gettext-parser`, script `build-js-po` running
  `build-utils/ts-extract-gettext.ts`). Frontend API in
  [static/app/locale.tsx](https://github.com/getsentry/sentry/blob/master/static/app/locale.tsx):
  `t`, `tct` (React component interpolation), `tn` (plurals).
- Catalog: gettext PO/MO per locale under `src/sentry/locale/<lang>/LC_MESSAGES/`,
  e.g. [django.po (de)](https://github.com/getsentry/sentry/blob/master/src/sentry/locale/de/LC_MESSAGES/django.po).
  Keys: natural-language English msgids (`msgid "Resolved"` → `msgstr "Gelöst"`).
- Typed keys: none; missing translations fall back to the English msgid at
  runtime.
- Lint: none found.
- Translators: Transifex —
  [.tx/config](https://github.com/getsentry/sentry/blob/master/.tx/config)
  (project `o:getsentry:p:sentry:r:djangopo`, type PO).
- Files inspected: `package.json`, `static/app/locale.tsx`, `.tx/config`,
  `src/sentry/locale/` listing, `src/sentry/locale/de/LC_MESSAGES/django.po`.

### Plausible (`plausible/analytics`, branch `master`)

- No i18n anywhere. The React dashboard's
  [assets/package.json](https://github.com/plausible/analytics/blob/master/assets/package.json)
  has zero i18n packages; even the Elixir side's
  [mix.exs](https://github.com/plausible/analytics/blob/master/mix.exs) lists
  no `gettext`/`ex_cldr`. All UI strings are hard-coded English. A reminder
  that shipping English-only is a legitimate v1 for an analytics-style tool.

### Excalidraw (`excalidraw/excalidraw`, branch `master`)

- Mechanism: in-house, zero i18n dependencies
  ([packages/excalidraw/package.json](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/package.json)).
  Implementation is one file,
  [packages/excalidraw/i18n.ts](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/i18n.ts):
  `t(path, replacement?, fallback?)` walks a nested object; locale JSON is
  lazy-imported with English fallback; `{{key}}` substitution.
- Catalog: JSON per locale (74 files) —
  [packages/excalidraw/locales/en.json](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/locales/en.json).
  Keys: semantic nested camelCase (`labels.pasteAsPlaintext`,
  `buttons.clearReset`).
- Typed keys: **yes, compile-time** —
  `export type TranslationKeys = NestedKeyOf<typeof fallbackLangData>` in
  `i18n.ts`; `t()`'s first param is typed against the inferred key paths of
  the imported `en.json`, so a bad key is a TS error.
- Lint: none.
- Translators: Crowdin —
  [crowdin.yml](https://github.com/excalidraw/excalidraw/blob/master/crowdin.yml);
  [locales/README.md](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/locales/README.md)
  forbids direct edits; languages ship only above a completion threshold.
- Files inspected: `packages/excalidraw/package.json`,
  `packages/excalidraw/i18n.ts`, `packages/excalidraw/locales/en.json`,
  `packages/excalidraw/locales/README.md`, `crowdin.yml`, `CONTRIBUTING.md`.

### Grafana (`grafana/grafana`, branch `main`)

- Mechanism: `i18next` + `react-i18next` wrapped by workspace package
  `@grafana/i18n`; extraction via `i18next-cli` —
  [root package.json](https://github.com/grafana/grafana/blob/main/package.json).
  API is `t('key', 'Default text', {vars})` and `<Trans i18nKey="...">` —
  [contribute/internationalization.md](https://github.com/grafana/grafana/blob/main/contribute/internationalization.md).
- Catalog: i18next nested JSON per locale —
  [public/locales/en-US/grafana.json](https://github.com/grafana/grafana/blob/main/public/locales/en-US/grafana.json).
  Keys: semantic dotted `feature.area.phrase`
  (`access-control.add-permission.role-label`, `common.cancel`), with
  purpose-prefixed leaves (`label-`, `aria-label-`, `tooltip-`).
- Typed keys: no —
  [packages/grafana-i18n/src/i18n.tsx](https://github.com/grafana/grafana/blob/main/packages/grafana-i18n/src/i18n.tsx)
  takes plain string ids with inline English defaults. Safety comes from lint
  plus extraction, not types.
- Lint: **yes** —
  [eslint.config.js](https://github.com/grafana/grafana/blob/main/eslint.config.js)
  enables `@grafana/i18n/no-untranslated-strings` (own rule shipped inside
  `packages/grafana-i18n/src/eslint/`), plus plural-default rules, scoped to
  feature dirs and excluding tests.
- Translators: Crowdin —
  [crowdin.yml](https://github.com/grafana/grafana/blob/main/crowdin.yml)
  (`i18next_json` type); internationalization.md says direct locale-file PRs
  are rejected.
- Files inspected: `package.json`, `public/locales/en-US/grafana.json`,
  `contribute/internationalization.md`, `crowdin.yml`, `eslint.config.js`,
  `packages/grafana-i18n/src/i18n.tsx`, `packages/grafana-i18n/README.md`.

### Documenso (`documenso/documenso`, branch `main`)

- Mechanism: Lingui v5 —
  [root package.json](https://github.com/documenso/documenso/blob/main/package.json)
  (`@lingui/core`, `@lingui/conf`, `@lingui/cli`; `lingui compile` runs before
  every `dev`);
  [apps/remix/package.json](https://github.com/documenso/documenso/blob/main/apps/remix/package.json)
  adds `@lingui/macro`, `@lingui/react`,
  `@lingui/babel-plugin-lingui-macro`, `@lingui/vite-plugin`. Config
  [lingui.config.ts](https://github.com/documenso/documenso/blob/main/lingui.config.ts)
  puts catalogs in a shared package: `packages/lib/translations/{locale}/web`.
- Catalog: gettext PO, 13 locales —
  [packages/lib/translations/en/web.po](https://github.com/documenso/documenso/blob/main/packages/lib/translations/en/web.po).
  Keys: natural-language msgids, including full ICU plurals inside msgids.
- Typed keys: structurally n/a — macros make the English source text the
  message; nothing to typo, nothing typed; missing translations fall back to
  English at runtime, and `lingui compile --strict` in CI catches gaps.
- Lint: none — repo uses Biome; `eslint-plugin-lingui` is not present.
- Translators: raw GitHub PRs editing `.po` files —
  [contributing-translations.mdx](https://github.com/documenso/documenso/blob/main/apps/docs/content/docs/developers/contributing/contributing-translations.mdx)
  — with Crowdin + AI backfill automation
  ([.github/workflows/translations-upload.yml](https://github.com/documenso/documenso/blob/main/.github/workflows/translations-upload.yml),
  [crowdin.yml](https://github.com/documenso/documenso/blob/main/crowdin.yml)).
- Files inspected: `package.json`, `apps/remix/package.json`,
  `lingui.config.ts`, `crowdin.yml`, `packages/lib/translations/en/web.po`,
  `apps/docs/.../contributing-translations.mdx`, `.../translations.mdx`,
  `.github/workflows/translations-upload.yml`.

## Part 2 — Candidate comparison

| | i18next + react-i18next | Lingui | FormatJS (react-intl) | In-house minimal |
| --- | --- | --- | --- | --- |
| Message format | own (`{{var}}`, `_one/_other` suffix plurals via Intl.PluralRules); ICU only via `i18next-icu` plugin | native ICU | native ICU | hand-rolled (`Intl.PluralRules` + interpolation) |
| Typed keys (compile error) | **yes** — `CustomTypeOptions` + typed `resources` | no (macros: source text is the message) | possible but fights the default hash-id workflow | **yes** — strongest (typed params per message) |
| ESLint no-literal-string | `eslint-plugin-i18next` (1.21M/wk, ISC, active) | `eslint-plugin-lingui` `no-unlocalized-strings` (338k/wk, MIT, official, library-independent) | `eslint-plugin-formatjs` `no-literal-string-in-jsx` (692k/wk, MIT) | borrow `eslint-plugin-lingui` or `eslint-plugin-i18next` |
| License | MIT | MIT | BSD-3 (react-intl) / MIT (tooling) — permissive, no commercial strings | n/a |
| Web bundle (min+gzip) | 13.5 kB + 10.0 kB = ~23.5 kB | 2.1 kB + 1.7 kB = ~3.8 kB (+ compiled catalogs) | 14.7 kB | ~0 |
| Build step | none (pure runtime) | **required**: macro transform + `lingui compile` | optional compile; extraction CLI | none |
| Runs without React (CLI) | yes — `i18next.t()` | yes — `@lingui/core` | yes — `@formatjs/intl` `createIntl` | yes |
| Single-file tsup bundle | yes — `resources` init option, plain objects | yes at runtime, but macro transform in tsup/esbuild is the open question | yes — plain-object messages | yes |
| Popularity | 20.6M/wk, 8.6k stars (+react-i18next 14.8M/wk, 10k stars) | 1.45M/wk (@lingui/core), 5.8k stars | 3.2M/wk, 14.7k stars (monorepo) | n/a |
| Weblate/Crowdin | first-class ("i18next JSON" format on both) | first-class (gettext PO on both) | plain JSON works on both | needs JSON catalog to qualify |

### ICU MessageFormat support

- i18next's native format is its own: `{{var}}` interpolation and plural key
  suffixes `_one/_other/_zero/_two/_few/_many` "streamlined with the one used
  in the Intl API", ordinal via an `ordinal` option; the `count` variable is
  mandatory for plurals
  ([plurals docs](https://www.i18next.com/translation-function/plurals)).
  ICU proper is available by swapping the format with the `i18next-icu`
  plugin (wraps `intl-messageformat`), at the cost of i18next's own
  interpolation/nesting/context features on those keys
  ([i18next-icu README](https://github.com/i18next/i18next-icu)).
- Lingui is ICU-native: `{name}`, `{count, plural, one {...} other {...}}`,
  `select`, `selectOrdinal`, exact matches (`=0`), offsets
  ([message format docs](https://lingui.dev/ref/message-format)).
- FormatJS is ICU-native: plural/select/selectordinal, number/date skeletons,
  rich-text tags
  ([ICU syntax docs](https://formatjs.github.io/docs/core-concepts/icu-syntax/)).
- In-house: `Intl.PluralRules` (Baseline "widely available since September
  2019", cardinal + ordinal —
  [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules))
  plus `Intl.NumberFormat`/`Intl.DateTimeFormat` (Baseline since 2017 —
  [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat)).
  Node ships full-ICU by default in official binaries
  ([Node Intl docs](https://nodejs.org/api/intl.html)).

### Typed keys

- i18next: declaration-merge `CustomTypeOptions` with a typed `resources`
  interface; unknown keys become compile errors (with `strictKeyChecks`),
  typed interpolation variables included. Documented gotchas: TS v5+
  expected; `returnNull: false` needed to avoid `string | null`; JSON files
  can't be `as const` so key unions come from importing the JSON (works) or
  from `.ts` catalogs; legacy key-validation types "enumerate every possible
  key, which gets expensive with thousands of keys" — mitigated by
  `enableSelector: "optimize"`
  ([TypeScript docs](https://www.i18next.com/overview/typescript)). At
  400–500 keys this repo is well under the danger zone.
- Lingui: no keys to type — macros turn source English into the message id at
  build time ([macro docs](https://lingui.dev/ref/macro)); the safety story
  is extraction plus `lingui compile --strict` failing on missing
  translations ([CLI docs](https://lingui.dev/ref/cli)). Nothing fails
  `tsc`.
- FormatJS: compile-time id checking exists (augment
  `FormatjsIntl.Message['ids']` with a union of ids —
  [react-intl TypeScript docs](https://formatjs.github.io/docs/react-intl/)),
  but the documented default workflow is auto-generated hash ids
  ("We recommend against explicit IDs since it can cause collision" —
  [message extraction docs](https://formatjs.github.io/docs/getting-started/message-extraction/)),
  which a typed-id setup has to fight.
- In-house: `as const` catalog (or imported JSON) + `keyof typeof` gives
  exhaustive key checking; template-literal types can additionally type the
  placeholder params per message — stronger than any library option.

### ESLint enforcement

- `eslint-plugin-i18next` (`no-literal-string`): by default checks "plain
  text in JSX markup"; `mode` widens to `jsx-only` (attributes too) or `all`
  (every string literal); configurable `callees`/words exclusions; no
  auto-fix by design. ISC license. Latest 6.1.5 published 2026-06-28;
  1,207,326 downloads/week (2026-08-03..09); 173 stars
  ([repo](https://github.com/edvardchen/eslint-plugin-i18next), npm registry
  + api.npmjs.org).
- `eslint-plugin-lingui` (official, lingui org): 11 rules;
  `no-unlocalized-strings` matches "all JSXText, StringLiterals, and
  TmplLiterals" including JSX attributes, with regex/function/name ignore
  lists and optional TS-type-aware mode (`useTsTypes`); it "operates
  independently of the Lingui runtime", so it is borrowable by a non-Lingui
  codebase. MIT. Latest 0.14.0 published 2026-06-05; 337,880 downloads/week
  ([rule doc](https://github.com/lingui/eslint-plugin/blob/main/docs/rules/no-unlocalized-strings.md)).
  Note the pre-1.0 version number.
- `eslint-plugin-formatjs` (the package `@formatjs/eslint-plugin` does not
  exist on npm): 21 rules; `no-literal-string-in-jsx` covers JSX children,
  string expressions, concatenation, and configured attributes (aria-label,
  placeholder, title, alt); plus ICU-correctness rules
  (`enforce-placeholders`, `no-invalid-icu`, `enforce-plural-rules`). MIT.
  Latest 6.4.20 published 2026-07-31; 692,117 downloads/week
  ([linter docs](https://formatjs.github.io/docs/tooling/linter/)).
- Generic fallback: `react/jsx-no-literals` (eslint-plugin-react) flags
  unwrapped JSX text, `noStrings`/`noAttributeStrings` widen it, but it flags
  any literal with no i18n awareness
  ([rule doc](https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/jsx-no-literals.md)).

### Licenses

- i18next: MIT ([LICENSE](https://github.com/i18next/i18next/blob/master/LICENSE));
  react-i18next: MIT ([LICENSE](https://github.com/i18next/react-i18next/blob/master/LICENSE)).
- Lingui: MIT ([LICENSE](https://github.com/lingui/js-lingui/blob/main/LICENSE)
  — copyright partly held by Crowdin, who sponsor maintenance; no usage
  strings attached).
- FormatJS: per-package, no root license — react-intl BSD-3-Clause
  ([LICENSE.md](https://github.com/formatjs/formatjs/blob/main/packages/react-intl/LICENSE.md)),
  intl-messageformat BSD
  ([LICENSE.md](https://github.com/formatjs/formatjs/blob/main/packages/intl-messageformat/LICENSE.md)),
  `@formatjs/intl`, `@formatjs/cli`, `eslint-plugin-formatjs` MIT. All
  permissive; BSD-3 only requires notice retention.

### Bundle cost (bundlephobia, min+gzip)

| Package | Version | min | min+gzip |
| --- | --- | --- | --- |
| i18next | 26.3.6 | 43.4 kB | 13.5 kB |
| react-i18next | 17.0.11 | 25.3 kB | 10.0 kB |
| i18next-icu | 2.4.4 | 4.9 kB | 2.0 kB (+ intl-messageformat below) |
| @lingui/core | 6.6.0 | 4.8 kB | 2.1 kB |
| @lingui/react | 6.6.0 | 3.7 kB | 1.7 kB |
| react-intl | 10.1.20 | 50.7 kB | 14.7 kB |
| intl-messageformat | 11.2.13 | 33.9 kB | 9.9 kB |
| @formatjs/intl | 4.1.18 | 45.2 kB | 13.0 kB |

Source: `bundlephobia.com/api/size?package=<name>@<version>`, fetched
2026-08-11. Lingui's runtime is tiny because ICU parsing happens at compile
time; compiled catalogs add size proportional to message count.

### Build-time requirements and SSR

- i18next: pure runtime, no compile step; catalogs can be bundled as plain
  objects via the `resources` init option
  ([add-or-load-translations docs](https://www.i18next.com/how-to/add-or-load-translations)).
  react-i18next is a normal React context provider; with synchronous
  bundled-resources init there is no async loading to trip SSR/streaming.
  TanStack Start-specific guidance: none in official docs (unverified, but no
  mechanism conflict identified).
- Lingui: macros are transformed "into ICU MessageFormat messages at compile
  time" ([macro docs](https://lingui.dev/ref/macro)) — requires
  `@lingui/babel-plugin-lingui-macro` or the SWC plugin; Vite is covered by
  `@lingui/vite-plugin`. Catalogs must go through `lingui compile` before
  runtime ([CLI docs](https://lingui.dev/ref/cli)). The open question for
  this repo: tsup is esbuild-based, and no esbuild macro plugin is
  documented — the CLI would either need a babel pre-pass or macro-free
  `i18n._()` calls (unverified whether any supported esbuild path exists).
- FormatJS: `@formatjs/cli compile` is optional but recommended (skips
  runtime ICU parsing —
  [message distribution docs](https://formatjs.github.io/docs/getting-started/message-distribution/));
  `@formatjs/unplugin` covers Vite/esbuild for id injection
  ([bundler plugins docs](https://formatjs.github.io/docs/guides/bundler-plugins/)).
  SSR via `createIntl` + `RawIntlProvider`
  ([API docs](https://formatjs.github.io/docs/react-intl/api/)).
- In-house: none.

### Shared package + single-file tsup CLI

- i18next: `i18next.t()` works with no React; init with `resources` = plain
  imported objects — no fs, no dynamic imports, bundles cleanly into one
  file. Two instances (web react-i18next, CLI bare i18next) share one catalog
  package.
- Lingui: `@lingui/core` "provides the main i18n object" with no React/DOM
  dependency; `i18n.load()` accepts compiled catalogs as plain objects
  ([core docs](https://lingui.dev/ref/core)). Runtime is fine; the macro
  build step in the CLI toolchain is the friction (above).
- FormatJS: `createIntl` is explicitly for "a non-React environment (Node,
  vue, angular, testing)" ([API docs](https://formatjs.github.io/docs/react-intl/api/));
  messages are plain objects.
- In-house: trivially fine.

### Translation platform compatibility

- Weblate supports "i18next JSON files", gettext PO, and plain/nested JSON
  ([supported formats](https://docs.weblate.org/en/latest/formats.html)).
  Hosted Weblate's Libre plan is gratis for public libre projects
  ([hosting page](https://weblate.org/en/hosting/)) — a hosted service, but
  free and not load-bearing: the catalogs stay in-repo and raw PRs remain
  possible.
- Crowdin natively supports i18next JSON including `_one`/`_other` plurals
  ([format page](https://store.crowdin.com/i18next-json)) and gettext PO
  ([format page](https://store.crowdin.com/gnu-gettext)). Free for OSS with
  eligibility criteria and a requirement to contribute translations to their
  global TM/NMT
  ([OSS setup page](https://crowdin.com/page/open-source-project-setup-request)).
- Raw catalog PRs: JSON is hand-editable in the GitHub web UI — the lowest
  friction for drive-by contributions; PO carries plural metadata natively
  but is line-format-fussy and usually edited with tools like Poedit
  (assessment, not a cited claim).

## Part 3 — Recommendation shortlist

| Rank | Option | One-line case | Key trade-off |
| --- | --- | --- | --- |
| 1 | i18next JSON + typed resources (+ eslint-plugin-i18next) | The plurality OSS-standard stack, with the typed-keys gap closed by `CustomTypeOptions` | ~23.5 kB gzip web runtime; suffix plurals instead of ICU |
| 2 | In-house minimal (Excalidraw model) | ~100 lines, zero deps, strongest typing (params per message) | Hand-rolled plural/select; no ecosystem; catalog must stay JSON to keep Weblate/Crowdin open |
| 3 | Lingui | Best DX for translated copy (ICU-native, 3.8 kB runtime, PO) | Mandatory macro/compile step with no documented esbuild/tsup path; no typed keys |

Not shortlisted: FormatJS/react-intl — nothing disqualifying (permissive
licenses, non-React core exists), but it is the largest runtime, its typed-id
story fights its own hash-id default workflow, and it brings no advantage
over i18next for this repo's constraints. No hard license or
runtime-without-React disqualifiers were found for any candidate; the two
real flags are Lingui's build-step requirement in a tsup CLI and
`eslint-plugin-lingui`'s pre-1.0 versioning.

### Option 1 — i18next with typed JSON resources (recommended)

i18next is what the closest comparables converged on (Grafana, Outline,
Cal.com), it is pure runtime with catalogs as plain imported objects — so the
shared package feeds react-i18next in apps/web and bare `i18next.t()` in the
single-file CLI with zero build machinery — and it is the only candidate
where compile-time key checking is a documented first-class feature rather
than a fight. Weblate has a dedicated i18next JSON format and hosted Weblate
is free for libre projects, while plain-JSON PRs stay open for drive-by
translators. The trade-off is accepting i18next's own message format: ~10
plural sites use `_one`/`_other` key suffixes (Intl.PluralRules-backed)
instead of ICU, and interpolation is `{{var}}` — adequate at this scale, and
`i18next-icu` exists as an escape hatch if ICU ever becomes necessary.

- (a) Catalog: i18next-format JSON (`en.json` per namespace) in a
  `packages/i18n`-style shared package (Cal.com precedent), exporting both
  the JSON and the init helpers; error templates keyed by the
  `packages/api` code vocabulary live in the same catalog.
- (b) Keys: semantic dotted `feature.area.phrase` (Grafana convention), not
  natural-language keys — keeps keys stable when copy changes and matches
  the error-code mapping.
- (c) Lint: `eslint-plugin-i18next` `no-literal-string` with `mode:
  "jsx-only"` initially (JSX text + attributes), `callees` tuned; active
  (June 2026), 1.2M downloads/week.
- (d) Typed keys: `i18next.d.ts` with `CustomTypeOptions` importing the
  English JSON; `strictKeyChecks` + `returnNull: false`; 400–500 keys is far
  below the documented TS-perf threshold.
- (e) CLI: same catalog package, `createInstance` + `resources` init,
  `i18next.t()` — no React, no fs, bundles into one file.

### Option 2 — In-house minimal, Excalidraw-style

A ~100-line module in the shared catalog package: English JSON catalog,
`t(key, params)` typed via `NestedKeyOf`/`keyof typeof` against the imported
JSON, `{{var}}` interpolation, plurals via an `Intl.PluralRules.select()`
switch on suffixed keys (mirroring the i18next JSON convention so
Weblate/Crowdin compatibility is preserved). This is proven at scale by
Excalidraw and is the only option with per-message typed params. The
trade-off: every future need (select/gender, ordinal, context, language
fallback chains) is hand-rolled, and community contributors get a bespoke
API instead of one they know. Lint via `eslint-plugin-lingui`'s
`no-unlocalized-strings`, which explicitly works independent of the Lingui
runtime, or `eslint-plugin-i18next` with `callees` pointed at the in-house
`t`. (a) JSON catalog in the shared package; (b) semantic dotted keys;
(c) borrowed lint rule as above; (d) typed keys and typed params for free;
(e) CLI reuse is trivial — it is plain TS.

### Option 3 — Lingui

The best pure-DX option for translator-facing copy: ICU-native messages,
tiny runtime (~3.8 kB gzip web), PO catalogs that professional tools and
Documenso-style raw PRs both handle, official ESLint plugin whose
`no-unlocalized-strings` is the most thorough literal-string rule surveyed.
It loses on this repo's two hard requirements: nothing fails `tsc` (safety
is extraction + `compile --strict`, i.e. CI-time not compile-time), and the
mandatory macro transform + `lingui compile` step has first-class Vite
support but no documented esbuild/tsup path for the single-file CLI — the
CLI would need a babel pre-pass or macro-free `i18n._()` calls, eroding the
DX that justifies Lingui. (a) PO catalogs in the shared package; (b) no keys
— English source is the id; (c) `eslint-plugin-lingui`; (d) no typed keys;
(e) `@lingui/core` runs fine without React but the build step follows the
CLI everywhere.
