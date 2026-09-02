// The ESLint sliver: flat config, NON-type-aware, zero custom
// plugins, and deliberately tiny. oxlint (`.oxlintrc.json`) is the primary
// linter and owns every rule it can express; this file carries ONLY the two
// house conventions oxlint cannot state:
//
//   1. the plain-`enum` ban (oxlint has `no-const-enum` and no
//      `no-restricted-syntax`, so plain `enum` is unreachable there),
//   2. extensionless relative imports,
//   3. the no-hard-coded-UI-copy gate on apps/web (eslint-plugin-i18next —
//      the one rule here that DOES need a plugin, because no linter can
//      express "this string reaches a browser" without i18n awareness).
//
// Both ride ESLint core's `no-restricted-syntax` over the TypeScript AST,
// which is why the only dependency beyond eslint is the parser: no plugin, no
// resolver, no type information, nothing to keep in sync with tsconfig.
// Adding a rule here that oxlint already runs is a defect — double-reporting
// the same violation is worse than not reporting it.
//
// A third candidate — SHOUT_CASE keys on exported `as
// const` maps — is NOT here. Without type information the only expressible
// selector is "exported `as const` object literal", which cannot tell a
// vocabulary map (the enum replacement the convention is about) from a frozen
// config record or a fixture bundle; measured on this repo it produced 8
// reports, all false positives, and 0 true ones. That convention stays prose.

import i18next from "eslint-plugin-i18next";
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

/**
 * The house `no-restricted-syntax` entries shared by every tree; the
 * apps/web JSX block below re-declares the rule (flat-config replacement,
 * not merge), so both spreads read from here.
 */
const BASE_RESTRICTED_SYNTAX = [
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
];

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
      "no-restricted-syntax": ["error", ...BASE_RESTRICTED_SYNTAX],
    },
  },
  {
    // User-facing copy lives in the catalog, never in a component. Scoped to
    // apps/web source: `jsx-only` covers JSX text AND attributes, which is
    // the shape a reviewer misses most. Tests and stories are exempt —
    // fixtures are not copy. The rule cannot see strings assigned to a
    // const (the sweep closed those by hand); the dev pseudo-locale is the
    // detector for what it misses.
    files: ["apps/web/src/**/*.tsx"],
    ignores: ["**/*.test.tsx", "**/*.stories.tsx"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-only",
          "jsx-attributes": {
            // Structural/behavioural attributes are never copy.
            exclude: [
              "className",
              "data-.*",
              "id",
              "key",
              "type",
              "role",
              "href",
              "to",
              "name",
              "value",
              "scope",
              "color",
              "as",
              "testId",
              "labelledBy",
              "describedBy",
              "aria-hidden",
              "aria-haspopup",
              "autoComplete",
              "rel",
              "target",
              "charSet",
              "property",
              "content",
              "crossOrigin",
              "boxClassName",
              "labelClassName",
              "triggerClassName",
              // SVG geometry/paint and other structural attributes.
              "stroke",
              "fill",
              "focusable",
              "viewBox",
              "xmlns",
              "d",
              "points",
              "offset",
              "stopColor",
              // Discriminant/behavioural props, never rendered as copy.
              "placement",
              "callout",
              "kind",
              "variant",
              "size",
              "density",
              "tone",
              "state",
              "side",
              "anchor",
              "components",
            ],
          },
          // The plugin's DEFAULT callee list (which already exempts `t`)
          // stays in force: a blanket exclude would silently exempt every
          // JSX nested in a call expression — `memo(...)`, `forwardRef(...)`,
          // and every `.map()` callback — which is most of this tree.
          words: {
            // Punctuation-only and single-glyph nodes are decoration, not
            // copy (arrows, separators, the disclosure caret). The named
            // entries are DISCRIMINANTS that happen to sit inside a JSX
            // attribute expression — union members, ARIA token values, and
            // floating-ui middleware names, never rendered text.
            exclude: [
              "^[^a-zA-Z]*$",
              "^.$",
              "^(chunk|group|last-review|previous-brief|step|reference|content|repo-policy|built-in|open|verdict|receipt|start)$",
            ],
          },
        },
      ],
    },
  },
  {
    // The shared-button enforcement (see docs/plans/button-migration-plan.md):
    // raw `<button>` JSX and `target="_blank"` on a raw `<a>` are banned in
    // apps/web source outside the shared components' own files. The bespoke
    // sites carry `eslint-disable-next-line no-restricted-syntax` with a
    // one-line reason — the disables ARE the allowlist — so inline config is
    // enabled for exactly this tree. The absolutes above lose nothing:
    // directives addressed to oxlint name rules ESLint never loads (inert),
    // and a directive naming these rules is reviewed like any lint-disable.
    files: ["apps/web/src/**/*.tsx"],
    ignores: [
      "apps/web/src/components/AccessibleLink/**",
      "apps/web/src/components/Button/**",
      "apps/web/src/components/Chip/**",
      "apps/web/src/components/IconButton/**",
      "apps/web/src/components/LinkButton/**",
      "apps/web/src/components/MenuItem/**",
      "apps/web/src/components/RowButton/**",
      "apps/web/src/components/Tabs/**",
      "apps/web/src/components/ToolbarButton/**",
    ],
    linterOptions: {
      noInlineConfig: false,
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        ...BASE_RESTRICTED_SYNTAX,
        {
          selector: 'JSXOpeningElement[name.name="button"]',
          message:
            "Raw <button> is banned: use the shared Button/IconButton/RowButton/ToolbarButton/Chip/MenuItem/LinkButton. A deliberately-bespoke affordance carries an eslint-disable-next-line with its reason.",
        },
        {
          selector:
            'JSXOpeningElement[name.name="a"] > JSXAttribute[name.name="target"][value.value="_blank"]',
          message:
            'target="_blank" on a raw <a> is banned: use AccessibleLink, which defaults rel and announces the new tab.',
        },
      ],
    },
  },
];
