import type { ValueOf } from "types/utils";
import type { z } from "zod/v4";
import type {
  tokenizeRequestSchema,
  warmRequestSchema,
  cancelRequestSchema,
  tokensReplySchema,
  workerReplySchema,
  replyEnvelopeSchema,
} from "./schemas";

export const DiffLineKinds = {
  HUNK: "hunk",
  ADD: "add",
  DEL: "del",
  CTX: "ctx",
  NOTE: "note",
} as const;
export type DiffLineKind = ValueOf<typeof DiffLineKinds>;

/**
 * Absent means the row came from the PR diff. `expanded` marks a later read
 * of the file; `guest` a row another diff produced, hosted by a table whose
 * chunk does not own it.
 */
export const DiffRowOrigins = {
  EXPANDED: "expanded",
  GUEST: "guest",
} as const;
export type DiffRowOrigin = ValueOf<typeof DiffRowOrigins>;

export interface DiffLine {
  kind: DiffLineKind;
  content: string;
  oldLine?: number;
  newLine?: number;
  origin?: DiffRowOrigin;
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
  /** The file line the side's first row sits on; 1 means the file's start. */
  startLine?: number;
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

/** One row's tokens as they cross the worker boundary: a Map clones, but only
 * an array can be stated as a schema. */
export type RowTokenEntry = [number, RowTokenLine];

export type RowTokenMap = Map<number, RowTokenLine>;

export interface FileGrammarRows {
  grammar: GrammarName;
  rowCount: number;
}

export interface GrammarBudgetPlan {
  admitted: GrammarName[];
  spentBytes: number;
}

/**
 * The diff row fields a tokenizer reads. Line numbers ride along so the
 * worker can see where a chunk slice skipped file lines and where a side
 * starts at the file's first line.
 */
export interface TokenizableRow {
  kind: DiffLineKind;
  content: string;
  oldLine?: number | undefined;
  newLine?: number | undefined;
  origin?: DiffRowOrigin | undefined;
}

/**
 * `hunk` reconstructs the two sides of a diff before tokenizing. `standalone`
 * is for rows that never came from a hunk: they are one side already, so they
 * tokenize in row order with nothing to reconstruct.
 */
export const TokenizeModes = {
  HUNK: "hunk",
  STANDALONE: "standalone",
} as const;
export type TokenizeMode = ValueOf<typeof TokenizeModes>;

export const TokenMessageKinds = {
  TOKENIZE: "tokenize",
  TOKENS: "tokens",
  FAILED: "failed",
  WARM: "warm",
  CANCEL: "cancel",
} as const;
/** @public */
export type TokenMessageKind = ValueOf<typeof TokenMessageKinds>;

export const TokenFailureReasons = {
  GRAMMAR_LOAD: "grammar-load",
  TOKENIZE: "tokenize",
  WORKER_ERROR: "worker-error",
  CANCELLED: "cancelled",
} as const;
export type TokenFailureReason = ValueOf<typeof TokenFailureReasons>;

export const ChunkTokenStatuses = {
  PENDING: "pending",
  READY: "ready",
  PLAIN: "plain",
  FAILED: "failed",
} as const;
/** @public */
export type ChunkTokenStatus = ValueOf<typeof ChunkTokenStatuses>;

export interface ChunkTokensReady {
  status: typeof ChunkTokenStatuses.READY;
  tokensByRow: RowTokenMap;
}

export interface ChunkTokensPlain {
  status: typeof ChunkTokenStatuses.PLAIN;
}

export interface ChunkTokensPending {
  status: typeof ChunkTokenStatuses.PENDING;
}

export interface ChunkTokensFailed {
  status: typeof ChunkTokenStatuses.FAILED;
  reason: TokenFailureReason;
}

export type ChunkTokensResult =
  | ChunkTokensReady
  | ChunkTokensPlain
  | ChunkTokensFailed;

export type ChunkTokensState =
  | ChunkTokensReady
  | ChunkTokensPlain
  | ChunkTokensPending;

// The wire shapes are the schemas; a consumer never names schemas.ts for a type.
export type TokenizeRequest = z.infer<typeof tokenizeRequestSchema>;
export type WarmRequest = z.infer<typeof warmRequestSchema>;
export type CancelRequest = z.infer<typeof cancelRequestSchema>;
export type TokensReply = z.infer<typeof tokensReplySchema>;
export type WorkerReply = z.infer<typeof workerReplySchema>;
export type ReplyEnvelope = z.infer<typeof replyEnvelopeSchema>;

export interface ChunkTokensRequest {
  /** The brief this chunk belongs to; chunk ids restart per brief. */
  briefKey: string;
  chunkId: string;
  filePath: string;
  rows: DiffLine[];
  /** The grammars this brief's budget admitted, from `planBriefGrammars`. */
  admitted: ReadonlySet<GrammarName>;
  /**
   * Names this chunk's expanded rows. A spliced chunk is a DIFFERENT set of
   * rows under the same chunk id, and its reply reconstructs both hunk sides
   * across the seam, so it cannot reuse the unexpanded chunk's reply. Absent
   * leaves the key byte-identical to a chunk that never expanded.
   */
  expansionKey?: string;
}

/**
 * A snippet has no hunk to reconstruct and no chunk id: its rows are one
 * side of one file, and `snippetKey` is whatever identity its renderer can
 * state, scoped to the brief the caller reads under.
 */
export interface SnippetTokensRequest {
  briefKey: string;
  snippetKey: string;
  filePath: string;
  rows: DiffLine[];
  admitted: ReadonlySet<GrammarName>;
  /** `standalone` unless the rows are a real diff with hunk headers. */
  mode?: TokenizeMode;
}

/**
 * `cancel` carries the caller's interest, not the request: two mounts of one
 * virtualized chunk share a promise, and only the last one to let go cancels
 * the work. A handle rather than an `AbortSignal` parameter because the
 * refused paths hand back a settled promise with nothing to abort.
 */
export interface ChunkTokensHandle {
  promise: Promise<ChunkTokensResult>;
  cancel: () => void;
}

export type DiffTokenWorkerHandle = Worker | undefined;

/** One file's tokenizable size, as the screen sees it before any worker runs. */
export interface BriefChunkSize {
  file: string;
  rowCount: number;
}
