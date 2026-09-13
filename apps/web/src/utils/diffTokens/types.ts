import type { ValueOf } from "types";

export const DiffLineKinds = {
  HUNK: "hunk",
  ADD: "add",
  DEL: "del",
  CTX: "ctx",
  NOTE: "note",
} as const;
export type DiffLineKind = ValueOf<typeof DiffLineKinds>;

export interface DiffLine {
  kind: DiffLineKind;
  content: string;
  oldLine?: number;
  newLine?: number;
}

export const HunkSideNames = {
  OLD: "old",
  NEW: "new",
} as const;
export type HunkSideName = ValueOf<typeof HunkSideNames>;

/**
 * One side of one hunk, reassembled into the continuous text the grammar
 * needs. `rowIndexes[i]` is the diff row `text[i]` came from.
 */
export interface HunkSide {
  side: HunkSideName;
  text: string[];
  rowIndexes: number[];
}

export const Preludes = {
  BLOCK_COMMENT: "/*",
  OPEN_TAG: "<Prelude",
} as const;
export type Prelude = ValueOf<typeof Preludes>;

export type DerivedPrelude = Prelude | undefined;

export const GrammarNames = {
  ASTRO: "astro",
  CSS: "css",
  DIFF: "diff",
  DOCKER: "docker",
  DOTENV: "dotenv",
  GRAPHQL: "graphql",
  HTML: "html",
  INI: "ini",
  JAVASCRIPT: "javascript",
  JSON: "json",
  JSONC: "jsonc",
  JSX: "jsx",
  MAKE: "make",
  MARKDOWN: "markdown",
  MDX: "mdx",
  PYTHON: "python",
  SCSS: "scss",
  SHELLSCRIPT: "shellscript",
  SQL: "sql",
  TOML: "toml",
  TSX: "tsx",
  TYPESCRIPT: "typescript",
  VUE: "vue",
  XML: "xml",
  YAML: "yaml",
} as const;
export type GrammarName = ValueOf<typeof GrammarNames>;

export type ResolvedGrammar = GrammarName | undefined;

/** `classId` indexes the palette class list the worker layer owns. */
export interface RowToken {
  text: string;
  classId: number;
}

export type RowTokenLine = RowToken[];

export type RowTokenMap = Map<number, RowTokenLine>;

export interface FileGrammarRows {
  grammar: GrammarName;
  rowCount: number;
}

export interface GrammarBudgetPlan {
  admitted: GrammarName[];
  spentBytes: number;
}
