// The shapes the session-write payload builders speak.
import type { CommentAnchorKinds } from "types";

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
