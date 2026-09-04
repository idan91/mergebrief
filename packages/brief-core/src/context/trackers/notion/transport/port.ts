import type { Result } from "types";
import type { ContextReadFailure } from "../../../types";

export type ReadResult<Value> = Result<Value, ContextReadFailure>;

export function failRead(
  reason: ContextReadFailure["reason"],
  detail: string,
): ReadResult<never> {
  return { ok: false, error: { reason, detail } };
}

/** One read's credential and budget; the token rides only in a header, never in a detail. */
export interface NotionSession {
  readonly token: string;
  readonly signal: AbortSignal;
}

export interface NotionDatabase {
  readonly dataSourceIds: readonly string[];
}

/** A data source's schema; property shapes are the read's to interpret. */
export interface NotionDataSource {
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface NotionPage {
  readonly id: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface NotionBlock {
  readonly id: string;
  readonly type: string;
  readonly hasChildren: boolean;
  /** The block's own payload under its type key; the read renders what it knows. */
  readonly payload: unknown;
}

export interface NotionBlockPage {
  readonly blocks: readonly NotionBlock[];
  readonly nextCursor: string | undefined;
}

export interface NotionUniqueIdFilter {
  readonly propertyName: string;
  readonly number: number;
}

/**
 * The port Notion's read talks through: typed operations, records decoded
 * inside the implementation. A root binds one of `NotionTransports`.
 */
export interface NotionTransport {
  /** One budget for a whole read; the read enforces it through the session signal. */
  readonly timeoutMs: number;
  getDatabase(
    session: NotionSession,
    databaseId: string,
  ): Promise<ReadResult<NotionDatabase>>;
  getDataSource(
    session: NotionSession,
    dataSourceId: string,
  ): Promise<ReadResult<NotionDataSource>>;
  /** The one page whose unique-id property carries the number, if any. */
  queryByUniqueId(
    session: NotionSession,
    dataSourceId: string,
    filter: NotionUniqueIdFilter,
  ): Promise<ReadResult<NotionPage | undefined>>;
  getPage(
    session: NotionSession,
    pageId: string,
  ): Promise<ReadResult<NotionPage>>;
  listBlockChildren(
    session: NotionSession,
    blockId: string,
    cursor: string | undefined,
  ): Promise<ReadResult<NotionBlockPage>>;
}
