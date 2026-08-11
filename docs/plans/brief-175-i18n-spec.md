# BRIEF-175 — i18n: UI string catalog + parameterized backend errors (spec)

Consolidates the six closed decisions of the BRIEF-175 wayfinder map. English-only
shipping; zero translations in v1. Companion implementation plan:
`brief-175-i18n-implementation.md`.

## 1. Mechanism

- **i18next.** `react-i18next` binding in apps/web; bare `i18next.t()` via
  `createInstance` in the CLI.
- **Typed keys**: `CustomTypeOptions` importing `en.json` + `strictKeyChecks` +
  `returnNull: false` — unknown key or wrong interpolation param is a compile error.
- **Catalog**: single flat `en.json` (nested keys) in the new **`packages/i18n`**
  (unscoped name `i18n`). Everything in: UI strings, error templates, locale
  date/number helpers. `locales/en.json` + `src/index.ts` barrel exporting
  `createI18n()` (resources baked in), catalog re-export, `TranslationKey` type;
  `i18next.d.ts` wiring ships from here. Dependency: i18next only — react-i18next
  stays in apps/web (CLI never pulls React). AGENTS.md + CLAUDE.md pointer + 75%
  coverage floor.
- **Key scheme**: semantic dotted camelCase `feature.area.phrase`;
  purpose-prefixed leaves where ambiguous (`ariaLabelClose`). Error keys:
  `errors.<code>` (verbatim kebab-case wire code); generation-failure keys:
  `generationError.<code>`. Lookup is `t("errors." + code)` — no mapping table.
- **Plurals**: i18next `_one`/`_other` suffix keys with mandatory `{ count }`;
  no `_zero` in English (`_other` covers 0; special zero-copy is its own key).
  Composite sentences split: plural core as keyed pair, suffixes as separate keys,
  composition in code. No ICU (`i18next-icu` is the escape hatch). Numbers/dates
  inside templates use i18next built-in Intl formatters (`{{val, number}}`);
  the locale-aware helper covers only formatting outside templates.
- **Lint**: `eslint-plugin-i18next` `no-literal-string`, `mode: "jsx-only"`,
  scoped to `apps/web/src`, tests/stories excluded; `callees`/attribute ignores
  tuned during the sweep. CLI unlinted in v1.
- **Locale selection**: explicit picker in the web header (compact: globe +
  native-name dropdown; exact treatment at implementation, impeccable gate
  applies); `navigator.language` first-visit default; localStorage persistence;
  fallback chain `locale → base-lang → en`; `lang` attribute set from the active
  locale. No server-side persistence. RTL deferred.

## 2. Wire error contract

One wire shape for all consumers: `{ error, code, params }` — `error` is the
English line composed server-side (CLI fallback + debugging), additive change,
ADR 0029 stderr shape intact.

- **Contract module**: `packages/api/src/error-response.ts` owns `ApiErrorCode`
  (`as const` + `ValueOf`), `ApiErrorBody` (discriminated union on `code`),
  1:1 code→status map (a code needing two statuses is two codes), code→English
  template map, and `errorJson(c, code, params?)`. Uniform `no-store` on ALL
  error responses. All 15 route files migrate (7 helper copies + 8 bare
  `c.json` files; ~135 sites).
- **Params**: only where a dynamic value exists — exactly one code today:
  `generation-config` with `{ detail }` (pre-clamped engine line). Additive later.
- **Existing enums** (`GitHubApiErrorCode`, `UrlBriefErrorKind`,
  `RefreshErrorCode`) stay internal, translated to wire codes at the per-route
  `…Failure` mappers, which keep the security collapses (uniform-404 posture).
  `LastReviewUnavailableReason` = modeled data inside 200s, stays out.

### Final code table (18 codes)

Statuses are today's, 1:1. Collapses only within one status.

| Code | Status | Collapses (today's sentences) | Params |
|---|---|---|---|
| `unauthorized` | 401 | "unauthorized" | — |
| `invalid-signature` | 401 | webhook HMAC reject (kept distinct: GitHub delivery-log debugging) | — |
| `forbidden` | 403 | "forbidden" | — |
| `github-permission` | 403 | "github-permission" (FE-actionable capability signal) | — |
| `not-found` | 404 | "not found" | — |
| `invalid-request` | 400 | "invalid request", "invalid request body", "invalid body", "invalid query parameters", "request body is not valid JSON", "malformed webhook payload", "invalid installation id" | — |
| `not-a-pr-url` | 400 | "not a pr url" (distinct user action: paste a PR URL) | — |
| `sign-in-failed` | 400 | "invalid oauth state", "oauth code exchange failed", "invalid callback parameters" (one user action: retry sign-in) | — |
| `request-too-large` | 413 | "request body too large" | — |
| `diff-too-large` | 413 | "diff too large to render" | — |
| `pr-changed-since-read` | 409 | "pull request changed since it was read" | — |
| `pr-rewritten-since-read` | 409 | "pull request was rewritten since it was read" | — |
| `app-not-installed` | (status from site) | "the app is not installed for this account" (FE-actionable: install link) | — |
| `github-unavailable` | 502 | "upstream error", "could not resolve the authenticated user", "could not resolve app installations" | — |
| `generation-failed` | 502 | "generation failed" | — |
| `generation-unavailable` | 503 | "url generation unavailable" | — |
| `generation-config` | 503 | clamped engine config line | `{ detail }` |
| `internal-error` | 500 | "internal error", "could not persist the session" | — |

### Consumers

- **CLI**: tolerant hand-rolled probe for code/params (no Zod). Known code →
  catalog template render + " (HTTP n)"; unknown/absent → verbatim `error` field.
  One stderr line; exit codes untouched. CLI gains a runtime dep on
  `packages/i18n` (its first workspace runtime dep).
- **Web**: `apiFetch` reads the body on `!ok` (tolerant); `ApiError` gains
  `code`, synthesized from status when the body has none. `ApiErrorKind` dies:
  web error space = hand-rolled mirror of `ApiErrorCode` + web-local
  `"malformed"` (2xx-parse failure, never on wire). The two duplicate
  `kindForStatus` copies fold into the shared path. `pr-changed-since-read`
  reaches the FE as a real code with re-read-and-retry copy.
- **Drift mesh**: English exists in two places by design (api-internal
  composition + consumer-side templates) — handled by pins, not shared source.
  api exports its code→English map mirror-only; `packages/i18n`'s suite pins
  completeness (every `ApiErrorCode` has `errors.<code>`) + wording (rendered
  en template equals api's composed line). Web mirror pinned Equals + runtime
  vocabulary style.

## 3. Redaction

Params are safe by construction: the contract module is the sole producer,
params typed per code, no free-form upstream text in a param unless
pre-sanitized. Belt: `REDACT_PATHS` += `params.<secretKey>` +
`*.params.<secretKey>`. **`sanitizeErrorDetail(text)`** (first line + 300-char
cap + URL scrub) moves to `packages/logging`, replacing the three identical
copies (api `clampConfigMessage`, persistence `sanitizeGenerationError` core,
web `clampConfigMessage`); logging's internal `file://`-exempt msg scrubber and
generators' `redactSecrets` stay separate.

## 4. Generation-failure persistence

- **`GenerationFailureCode`** owned by `packages/persistence` (DB-stored
  vocabulary, CHECK-constrained; distinct from the store-internal
  `GenerationErrorCode`). 11 codes: `provider-auth`, `provider-rate-limit`,
  `provider-timeout`, `provider-unavailable`, `provider-refusal`,
  `output-invalid`, `generation-config` `{detail}` (absorbs cli-missing),
  `github-access`, `diff-too-large`, `github-unavailable`, `unknown` `{detail}`.
- **Schema**: `generation.error` (text) replaced by `error_code` (text, CHECK)
  + `error_params` (jsonb). One migration: add + CHECK, backfill
  `error IS NOT NULL` → `unknown` + `{detail: error}`, drop `error`. Migrated,
  not wiped. Every error-clearing transition clears both columns.
- **Seam**: `markFailed(target, failure)` takes the typed union; persistence
  applies `sanitizeErrorDetail` to any `detail` (callers cannot bypass).
  Worker classifies in a new `task/failure.ts` (GeneratorError kinds → codes;
  status map 429/408/5xx/401/403; `APIConnectionError` → provider-unavailable);
  GitHub failures stamped at the throw site (`PermanentJobError` gains an
  optional failure field; transient branch throws a sibling class). Classifier:
  stamp first, instanceof/status probe second, `unknown{detail}` last.
- **Wire + render**: `GenerationSummaryView` drops `error`, gains
  `errorCode`/`errorParams` (modeled data in a 200 — not wire `ApiErrorCode`).
  FailedCard renders `generationError.<code>` from the catalog;
  `generationError.unknown` interpolates `{{detail}}`; unknown-to-web code →
  generic failed line. Web hand-mirrors the vocab (GenerationStatuses
  precedent); catalog-completeness pin rides apps/web's suite.

## 5. Community translation docs

- **Walkthrough** in `packages/i18n/README.md`; CONTRIBUTING.md gains a short
  Translations section (what a locale PR looks like, link, RTL-not-yet-supported
  statement). Root README untouched. Reader-facing docs reference-free.
- **Locale PR shape**: `<locale>.json` + one `{ id, nativeName }` entry in a
  `locales.ts` registry (doubles as the picker's curated list). No build magic.
- **Review bar**: mechanical bar CI-enforced (valid JSON, no invented/stale
  keys, `{{param}}` sets untouched, plural suffixes, no markup injection);
  fluency community-owned — no native-speaker gate; machine translation
  declared in the PR + human-reviewed, raw MT dumps parkable.
- **Completeness policy**: partial locales ship; missing keys fall back through
  the chain. Gates report, never percentage-block.

## 6. Catalog QA

- **All gates in `packages/i18n`'s vitest suite** (CI's pnpm graph filter runs
  it + dependents on every locale PR; zero new CI wiring). Hard-fail: JSON
  parses, keys exist in en.json, `{{param}}` token sets match en, plural suffix
  sets match. Report-only: passing test printing per-locale coverage % +
  missing keys. Coverage floor measures `src/`, not JSON.
- **Pseudo-locale**: ~30-line in-house i18next postProcessor, dev-only
  (accent-map + ~35% pad), picker entry visible in dev builds only. No file,
  no dependency. Strings not routed through `t()` stay plain English — the
  leak detector the jsx-only lint can't be.

## 7. AGENTS.md distribution

Root: one bullet (copy lives in the catalog, never hard-coded; wire error codes
follow the api recipe). `packages/i18n/AGENTS.md`: catalog invariants (key
grammar, plurals, en.json source of truth, locale files community-owned, pins).
`apps/web/AGENTS.md`: externalization section — module-local `COPY` maps are
dead. `packages/api/AGENTS.md`: new-error-code recipe. `packages/persistence/AGENTS.md`:
GenerationFailureCode line (new code = CHECK migration + catalog key + web mirror).

## Out of scope (map-ruled)

LLM-generated brief content language (BRIEF-178); RTL (trigger: first RTL
locale contribution); CLI localization beyond English render (trigger: demand);
server-side locale persistence (trigger: user-accounts demand).
