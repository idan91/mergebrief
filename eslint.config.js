// The ESLint sliver (ADR 0038 §7): flat config, NON-type-aware, zero custom
// plugins, and deliberately tiny. oxlint (`.oxlintrc.json`) is the primary
// linter and owns every rule it can express; this file carries ONLY the two
// house conventions oxlint cannot state:
//
//   1. the plain-`enum` ban (oxlint has `no-const-enum` and no
//      `no-restricted-syntax`, so plain `enum` is unreachable there),
//   2. extensionless relative imports.
//
// Both ride ESLint core's `no-restricted-syntax` over the TypeScript AST,
// which is why the only dependency beyond eslint is the parser: no plugin, no
// resolver, no type information, nothing to keep in sync with tsconfig.
// Adding a rule here that oxlint already runs is a defect — double-reporting
// the same violation is worse than not reporting it.
//
// The third candidate from ADR 0038 §7 — SHOUT_CASE keys on exported `as
// const` maps — is NOT here. Without type information the only expressible
// selector is "exported `as const` object literal", which cannot tell a
// vocabulary map (the enum replacement the convention is about) from a frozen
// config record or a fixture bundle; measured on this repo it produced 8
// reports, all false positives, and 0 true ones. That convention stays prose.

import tsParser from "@typescript-eslint/parser";

/**
 * Relative import specifiers that must never carry the extension
 * (extensionless-import rule). Anchored to `^\.` — bare package names that
 * merely end in a matched extension (`highlight.js`, `crypto-js/sha256.js`)
 * must pass, and with `noInlineConfig` there would be no per-site escape
 * hatch if they didn't.
 */
const RELATIVE_TS_JS_EXTENSION = String.raw`/^\..*\.[cm]?[jt]sx?$/`;

const EXTENSIONLESS_IMPORT_MESSAGE =
  "Import without the file extension (`./tenant`, not `./tenant.js`) — every package is bundler-resolved end to end. Extensions stay only on non-TS assets (.css, .scss, .json).";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/out/**",
      "**/coverage/**",
      "**/.playwright-cli/**",
      "**/.tanstack/**",
      "**/routeTree.gen.ts",
      "**/*.gen.*",
      "mockup/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2024,
      sourceType: "module",
    },
    // Inline disable comments in this tree are addressed to oxlint, whose rule
    // names ESLint cannot resolve (it errors on every one). ESLint therefore
    // reads none of them — and the two rules below are absolutes with no
    // sanctioned per-site escape hatch, so nothing is lost. ESLint still warns
    // once per ignored directive, which is why the `lint` script runs it with
    // `--quiet`: every rule here is an error, so warnings carry no signal.
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message:
            "No `enum`: use an `as const` map with SHOUT_CASE keys and kebab-case string values, plus `ValueOf<typeof Map>` for the union type.",
        },
        {
          selector: `ImportDeclaration[source.value=${RELATIVE_TS_JS_EXTENSION}]`,
          message: EXTENSIONLESS_IMPORT_MESSAGE,
        },
        {
          selector: `ExportNamedDeclaration[source.value=${RELATIVE_TS_JS_EXTENSION}]`,
          message: EXTENSIONLESS_IMPORT_MESSAGE,
        },
        {
          selector: `ExportAllDeclaration[source.value=${RELATIVE_TS_JS_EXTENSION}]`,
          message: EXTENSIONLESS_IMPORT_MESSAGE,
        },
        {
          selector: `ImportExpression[source.value=${RELATIVE_TS_JS_EXTENSION}]`,
          message: EXTENSIONLESS_IMPORT_MESSAGE,
        },
        {
          // Type-position `typeof import("./x.js")` — the specifier sits
          // inside a TSLiteralType wrapper, hence `argument.literal`.
          selector: `TSImportType[argument.literal.value=${RELATIVE_TS_JS_EXTENSION}]`,
          message: EXTENSIONLESS_IMPORT_MESSAGE,
        },
        // Known gap, accepted: a template-literal dynamic import
        // (import(`./x.js`)) is invisible to esquery value matching. Static
        // specifiers — the only shape the convention governs — are covered.
      ],
    },
  },
];
