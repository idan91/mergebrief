# i18n

The string catalog. English ships as the source locale (`locales/en.json`);
every other locale is community-contributed. The web app and the CLI both
render from this package — one catalog, no per-app copies.

## Contribute a translation

A locale PR is two files touched, no build steps:

1. **Copy `locales/en.json` to `locales/<id>.json`** — `<id>` is the
   BCP 47 tag (`fr`, `pt-BR`). Translate the values; never change the keys
   or the `{{param}}` tokens. Numbered slots (`<0/>`) must all survive, but
   move them wherever your language needs — see below.
   Partial files are welcome — untranslated keys fall back to English at
   runtime.
2. **Add one row to `LOCALES` in `src/locales.ts`** with the locale id and
   its native name (`{ id: "fr", nativeName: "Français" }`), and one entry
   to `RESOURCES` importing your file. The native name is what the locale
   picker shows.

Run `pnpm -C packages/i18n test` before opening the PR. The suite is the
review bar:

- **Hard-fail (mechanical)**: file parses, every key exists in `en.json`,
  `{{param}}` token and `<0>` slot sets match, plural suffixes are valid
  (`_one`/`_other`/…) and used only where English is pluralized, no markup
  in values beyond the numbered slots, no empty values.
- **Report-only**: per-locale coverage prints in the test output; missing
  keys never block a locale from shipping.

### Numbered slots

A few values wrap part of the sentence in an element the app supplies — a
link, a `<code>` span:

```json
"signInPrompt": "<0/> to manage API tokens."
```

`<0/>` is a position, not markup: it marks where the app drops that element
in. There is nothing to translate inside it. Move it wherever your language
needs it — that freedom is the whole point of the slot, and it is why these
sentences are one entry instead of two halves.

You may also meet the paired form, `<0>some text</0>` — translate the text
inside it and move the whole thing as one unit. Never convert between the
two forms: a `<0/>` rewritten as `<0>…</0>` replaces what the app puts
there, so a link would lose its real label. The suite rejects it.

Keep every numbered slot the English value has, use each exactly once, and
never add one. No other angle brackets are allowed. For a plural key, your
`_few`/`_many` forms are compared against English's `_other`.

Fluency review is community-owned — there is no native-speaker gate.
Machine translation is fine as a starting point if the PR says so and a
human has reviewed every line; raw MT dumps are parked until reviewed.

Right-to-left locales are not yet supported — an RTL contribution is the
trigger for building that support, so open an issue first.

## Plurals

i18next suffix keys, mandatory `{ count }`:

```json
"attempts_one": "{{count}} attempt",
"attempts_other": "{{count}} attempts"
```

Use your language's plural categories (`_few`, `_many`, …) — the gates
accept any valid category of a known base key. English `_other` covers
zero; a special zero-copy is its own key, not `_zero`.

## For code

```ts
import { createI18n } from "i18n";

const i18n = createI18n({ locale: "en" });
i18n.t("errors.not-found");
```

Keys are typed: an unknown key is a compile error. Web code goes through
react-i18next (`apps/web` wiring), the CLI calls `t()` bare. The `pseudo`
locale (dev-only) accent-pads every rendered string — anything still plain
English on screen bypassed the catalog.
