// The shapes the session-write payload builders speak.
import type {
  OperationParams,
  ProductActionId,
  ProductActionIds,
} from "contract";
import type { CommentAnchorKinds } from "types/comments";
import type { BriefSpan } from "../../types";

export interface ChunkMarks {
  readonly id:
    | typeof ProductActionIds.MARK_CHUNK_READ
    | typeof ProductActionIds.MARK_CHUNK_UNREAD;
  readonly repoId: string;
  readonly prNumber: number;
  readonly span: BriefSpan;
  readonly chunkIds: readonly string[];
}

/**
 * The anchor flags `draft create`/`draft reanchor` share. The explicit
 * `| undefined` is for `exactOptionalPropertyTypes`: callers assign
 * commander's `string | undefined` option values directly.
 */
export interface AnchorFlags {
  readonly file?: string | undefined;
  readonly side?: string | undefined;
  readonly startSide?: string | undefined;
  readonly start?: string | undefined;
  readonly end?: string | undefined;
}

/** Line-arm flag payload. `side` defaults to `new` in the builder. */
export interface LineFlagAnchor {
  filePath?: string;
  side: string;
  startSide?: string;
  startLine?: number;
  endLine?: number;
  body?: string;
}

/** File-arm flag payload. No line columns. */
export interface FileFlagAnchor {
  kind: typeof CommentAnchorKinds.FILE;
  filePath: string;
  body?: string;
}

/** The flag-built draft anchor as the wire carries it. */
export type FlagAnchor = LineFlagAnchor | FileFlagAnchor;

export interface CreateDraftInput extends AnchorFlags {
  /** Parsed `-F` payload, if one was given. */
  readonly payload?: unknown;
  readonly body?: string | undefined;
}

export interface UpdateDraftInput {
  readonly payload?: unknown;
  readonly body?: string | undefined;
}

export interface ReanchorInput extends AnchorFlags {
  readonly payload?: unknown;
}

/** A session operation as a command names it: the row, its params, the span. */
export interface SessionOperation<Id extends ProductActionId> {
  readonly id: Id;
  readonly params: OperationParams<Id>;
  readonly span: BriefSpan;
  /** The JSON body; absent sends none. */
  readonly payload?: unknown;
}

/** The three risk verbs `risk dismiss|address|reopen` send. */
export type RiskOperationId =
  | typeof ProductActionIds.DISMISS_RISK
  | typeof ProductActionIds.ADDRESS_RISK
  | typeof ProductActionIds.REOPEN_RISK;

/** The flags every `risk` subcommand reads. */
export interface RiskFlags {
  payload?: string;
  reason?: string;
  base?: string;
  head?: string;
}
