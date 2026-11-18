import { DiffLineKinds, type DiffLineKind } from "types/diff-lines";
import {
  GrammarNames,
  GrammarSupportModules,
  type GrammarModuleName,
  type GrammarName,
} from "./types";

export const GRAMMAR_BUDGET_BYTES = 100 * 1024;

/**
 * How long a row may stay transparent waiting for colour. A worker that
 * never answers must not leave code invisible, so the row falls back to
 * plain text at this point.
 */
export const PENDING_CEILING_MS = 400;

/** Chunks above this row count are rendered plain, never tokenized. */
export const CHUNK_ROW_CEILING = 1000;

// Measured against @shikijs/langs 4.4.3: gzip level 9 over each grammar
// module on its own. Re-measure on a shiki upgrade; a stale number silently
// overspends the budget.
export const GRAMMAR_MODULE_GZIP_BYTES: Record<GrammarModuleName, number> = {
  [GrammarSupportModules.VUE_INTERPOLATIONS]: 262,
  [GrammarSupportModules.VUE_DIRECTIVES]: 288,
  [GrammarSupportModules.MARKDOWN_VUE]: 408,
  [GrammarSupportModules.VUE_SFC_STYLE_VARIABLE_INJECTION]: 440,
  [GrammarSupportModules.HTML_DERIVATIVE]: 463,
  [GrammarNames.INI]: 515,
  [GrammarNames.DOTENV]: 549,
  [GrammarNames.DOCKER]: 611,
  [GrammarNames.DIFF]: 700,
  [GrammarNames.JSON]: 798,
  [GrammarNames.JSONC]: 815,
  [GrammarNames.XML]: 1224,
  [GrammarNames.TOML]: 1304,
  [GrammarSupportModules.GLSL]: 1414,
  [GrammarSupportModules.REGEXP]: 1444,
  [GrammarNames.MAKE]: 1788,
  [GrammarNames.R]: 1862,
  [GrammarSupportModules.POSTCSS]: 1945,
  [GrammarNames.HCL]: 1958,
  [GrammarNames.DART]: 2027,
  [GrammarNames.KOTLIN]: 2163,
  [GrammarNames.YAML]: 2290,
  [GrammarNames.GRAPHQL]: 2486,
  [GrammarNames.TERRAFORM]: 2543,
  [GrammarNames.VUE]: 2598,
  [GrammarNames.RUST]: 2736,
  [GrammarNames.ELIXIR]: 2766,
  [GrammarNames.SVELTE]: 3156,
  [GrammarNames.LUA]: 3175,
  [GrammarNames.SCALA]: 3938,
  [GrammarNames.POWERSHELL]: 4102,
  [GrammarNames.SCSS]: 4234,
  [GrammarNames.JAVA]: 4316,
  [GrammarNames.GO]: 5141,
  [GrammarNames.MARKDOWN]: 5643,
  [GrammarNames.SHELLSCRIPT]: 6144,
  [GrammarNames.SQL]: 7439,
  [GrammarNames.ASTRO]: 7536,
  [GrammarNames.PYTHON]: 9227,
  [GrammarNames.C]: 10578,
  [GrammarNames.CSHARP]: 10922,
  [GrammarNames.HTML]: 11702,
  [GrammarNames.CSS]: 11900,
  [GrammarNames.SWIFT]: 14818,
  [GrammarNames.TYPESCRIPT]: 16143,
  [GrammarNames.JAVASCRIPT]: 16475,
  [GrammarNames.TSX]: 16476,
  [GrammarNames.JSX]: 16615,
  [GrammarSupportModules.CPP_MACRO]: 21012,
  [GrammarNames.MDX]: 23534,
  [GrammarNames.PHP]: 28717,
  [GrammarNames.CPP]: 33226,
};

/**
 * Every other module a grammar's import closure loads. A grammar absent here
 * loads its own module only.
 */
export const GRAMMAR_SIBLING_MODULES: Partial<
  Record<GrammarName, readonly GrammarModuleName[]>
> = {
  [GrammarNames.ASTRO]: [
    GrammarNames.CSS,
    GrammarNames.JAVASCRIPT,
    GrammarNames.JSON,
    GrammarSupportModules.POSTCSS,
    GrammarNames.TSX,
    GrammarNames.TYPESCRIPT,
  ],
  [GrammarNames.CPP]: [
    GrammarNames.C,
    GrammarSupportModules.CPP_MACRO,
    GrammarSupportModules.GLSL,
    GrammarSupportModules.REGEXP,
  ],
  [GrammarNames.ELIXIR]: [
    GrammarNames.CSS,
    GrammarNames.HTML,
    GrammarNames.JAVASCRIPT,
  ],
  [GrammarNames.GRAPHQL]: [
    GrammarNames.JAVASCRIPT,
    GrammarNames.JSX,
    GrammarNames.TSX,
    GrammarNames.TYPESCRIPT,
  ],
  [GrammarNames.HTML]: [GrammarNames.CSS, GrammarNames.JAVASCRIPT],
  [GrammarNames.LUA]: [GrammarNames.C],
  [GrammarNames.PHP]: [
    GrammarNames.CSS,
    GrammarNames.HTML,
    GrammarNames.JAVA,
    GrammarNames.JAVASCRIPT,
    GrammarNames.JSON,
    GrammarNames.SQL,
    GrammarNames.XML,
  ],
  [GrammarNames.SCSS]: [GrammarNames.CSS],
  [GrammarNames.SVELTE]: [
    GrammarNames.CSS,
    GrammarNames.JAVASCRIPT,
    GrammarSupportModules.POSTCSS,
    GrammarNames.TYPESCRIPT,
  ],
  [GrammarNames.VUE]: [
    GrammarNames.CSS,
    GrammarNames.HTML,
    GrammarSupportModules.HTML_DERIVATIVE,
    GrammarNames.JAVASCRIPT,
    GrammarNames.JSON,
    GrammarSupportModules.MARKDOWN_VUE,
    GrammarNames.TYPESCRIPT,
    GrammarSupportModules.VUE_DIRECTIVES,
    GrammarSupportModules.VUE_INTERPOLATIONS,
    GrammarSupportModules.VUE_SFC_STYLE_VARIABLE_INJECTION,
  ],
  [GrammarNames.XML]: [GrammarNames.JAVA],
};

/** The gutter sign of a diff row; hunk, context and note rows carry a space. */
export const DIFF_LINE_SIGNS: Record<DiffLineKind, string> = {
  [DiffLineKinds.ADD]: "+",
  [DiffLineKinds.DEL]: "−",
  [DiffLineKinds.CTX]: " ",
  [DiffLineKinds.HUNK]: " ",
  [DiffLineKinds.NOTE]: " ",
};
