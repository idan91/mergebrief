import { DiffLineKinds, type DiffLineKind } from "types/diff-lines";
import { GrammarNames, type GrammarName } from "./types";

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
// module plus the sibling grammar modules it statically imports. Re-measure
// on a shiki upgrade; a stale number silently overspends the budget.
export const GRAMMAR_GZIP_BYTES: Record<GrammarName, number> = {
  [GrammarNames.INI]: 515,
  [GrammarNames.DOTENV]: 549,
  [GrammarNames.DOCKER]: 611,
  [GrammarNames.DIFF]: 700,
  [GrammarNames.JSON]: 798,
  [GrammarNames.JSONC]: 815,
  [GrammarNames.TOML]: 1304,
  [GrammarNames.MAKE]: 1788,
  [GrammarNames.YAML]: 2290,
  [GrammarNames.XML]: 5540,
  [GrammarNames.MARKDOWN]: 5643,
  [GrammarNames.SHELLSCRIPT]: 6144,
  [GrammarNames.SQL]: 7439,
  [GrammarNames.PYTHON]: 9227,
  [GrammarNames.CSS]: 11900,
  [GrammarNames.SCSS]: 16134,
  [GrammarNames.TYPESCRIPT]: 16143,
  [GrammarNames.JAVASCRIPT]: 16475,
  [GrammarNames.TSX]: 16476,
  [GrammarNames.JSX]: 16615,
  [GrammarNames.MDX]: 23534,
  [GrammarNames.HTML]: 40077,
  [GrammarNames.VUE]: 61477,
  [GrammarNames.GRAPHQL]: 68195,
  [GrammarNames.ASTRO]: 71273,
};

/** The gutter sign of a diff row; hunk, context and note rows carry a space. */
export const DIFF_LINE_SIGNS: Record<DiffLineKind, string> = {
  [DiffLineKinds.ADD]: "+",
  [DiffLineKinds.DEL]: "−",
  [DiffLineKinds.CTX]: " ",
  [DiffLineKinds.HUNK]: " ",
  [DiffLineKinds.NOTE]: " ",
};
