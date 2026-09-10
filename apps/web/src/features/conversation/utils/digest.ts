// Bot groups collapse but remain accessible; sorting never uses their stated severity.
// Outdated threads need revision labels because anchor-time coordinates are untrusted.
// Unanchored fresh threads and PR-level comments belong in the general group.
import type { BriefChunk } from "../../brief/types";
import {
  placeThread,
  ThreadPlacementKinds,
  UnanchoredReasons,
  type FileOrChunkPlacement,
  type ThreadPlacement,
} from "./anchor";
import { deriveDigestLine } from "./digestLine";
import type {
  ConversationThread,
  PrConversation,
  PrLevelComment,
} from "../types";
import type { Mutable, ValueOf } from "types";
import type { TFunction } from "i18next";

export const DigestRowKinds = {
  THREAD: "thread",
  BOT_GROUP: "bot-group",
} as const;

export const DigestGroupKinds = {
  CHUNK: "chunk",
  OUTDATED: "outdated",
  GENERAL: "general",
} as const;
export type DigestGroupKind = ValueOf<typeof DigestGroupKinds>;

export interface DigestThreadRow {
  readonly kind: typeof DigestRowKinds.THREAD;
  readonly thread: ConversationThread;
  /** The one-liner for the row (digest-line spec over the root body). */
  readonly digestLine: string;
  readonly placement: ThreadPlacement;
  /** True when the thread came from this reviewer's recorded submits. */
  readonly isOwn: boolean;
  /** Short anchor revision label, outdated rows only. */
  readonly anchorLabel?: string;
  /**
   * The viewed revision's generation cutoff, stamped on every row so the
   * detail renderers can mark comments that postdate the brief.
   */
  readonly briefGeneratedAt?: string;
}

export interface DigestBotGroupRow {
  readonly kind: typeof DigestRowKinds.BOT_GROUP;
  readonly author: string;
  /** Per-thread rows revealed on expand, already sorted. */
  readonly threads: readonly DigestThreadRow[];
  readonly openCount: number;
}

export type DigestRow = DigestThreadRow | DigestBotGroupRow;

export interface DigestGroup {
  /** Stable id for expansion bookkeeping: `chunk:<id>` | `outdated` | `general`. */
  readonly id: string;
  readonly kind: DigestGroupKind;
  readonly label: string;
  readonly chunkId?: string;
  readonly rows: readonly DigestRow[];
  /** PR-level (issue) comments, general group only. */
  readonly prComments?: readonly PrLevelComment[];
}

export interface BuildConversationDigestInput {
  readonly conversation: PrConversation;
  readonly chunks: readonly BriefChunk[];
  readonly ownThreadIds: ReadonlySet<number>;
  /** The viewed revision's generation cutoff; absent marks nothing. */
  readonly briefGeneratedAt?: string | undefined;
}

const SHORT_SHA_LENGTH = 7;

function threadRow(
  thread: ConversationThread,
  placement: ThreadPlacement,
  ownThreadIds: ReadonlySet<number>,
  briefGeneratedAt: string | undefined,
): DigestThreadRow {
  const rootBody = thread.comments[0]?.body ?? "";
  const anchorLabel =
    thread.isOutdated && thread.anchorSha !== undefined
      ? thread.anchorSha.slice(0, SHORT_SHA_LENGTH)
      : undefined;
  const row: Mutable<DigestThreadRow> = {
    kind: DigestRowKinds.THREAD,
    thread,
    digestLine: deriveDigestLine(rootBody),
    placement,
    isOwn: ownThreadIds.has(thread.rootCommentId),
  };

  if (anchorLabel !== undefined) row.anchorLabel = anchorLabel;
  if (briefGeneratedAt !== undefined) row.briefGeneratedAt = briefGeneratedAt;

  return row;
}

/**
 * The row index inside the chunk's diff (from `rowId` = `chunkId:index`),
 * the ONE reading-order axis. LEFT old-line and RIGHT new-line numbers are
 * not comparable; the placement already resolved both to a row position.
 */
function placementRowIndex(row: DigestThreadRow): number {
  if (row.placement.kind === ThreadPlacementKinds.FILE_HEADER) return -1;
  if (row.placement.kind !== ThreadPlacementKinds.CHUNK) {
    return Number.MAX_SAFE_INTEGER;
  }
  const index = Number(row.placement.rowId.split(":").at(-1));
  return Number.isNaN(index) ? Number.MAX_SAFE_INTEGER : index;
}

/** Unresolved first, then reading order (diff-row position, then thread id). */
function compareRows(left: DigestThreadRow, right: DigestThreadRow): number {
  if (left.thread.isResolved !== right.thread.isResolved) {
    return left.thread.isResolved ? 1 : -1;
  }
  const leftIndex = placementRowIndex(left);
  const rightIndex = placementRowIndex(right);
  if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  const leftLine = left.thread.line ?? Number.MAX_SAFE_INTEGER;
  const rightLine = right.thread.line ?? Number.MAX_SAFE_INTEGER;
  if (leftLine !== rightLine) return leftLine - rightLine;
  return left.thread.rootCommentId - right.thread.rootCommentId;
}

/** Humans stay per-thread rows; bots aggregate per author (collapse, never hide). */
function toRows(rows: readonly DigestThreadRow[]): DigestRow[] {
  const humans: DigestThreadRow[] = [];
  const byBot = new Map<string, DigestThreadRow[]>();
  for (const row of rows) {
    const author = row.thread.comments[0]?.author;
    if (author?.isBot) {
      const list = byBot.get(author.login) ?? [];
      list.push(row);
      byBot.set(author.login, list);
    } else {
      humans.push(row);
    }
  }
  const botGroups: DigestBotGroupRow[] = [...byBot.entries()].map(
    ([author, threads]) => ({
      kind: DigestRowKinds.BOT_GROUP,
      author,
      threads,
      openCount: threads.filter((row) => !row.thread.isResolved).length,
    }),
  );
  // Unresolved-first applies across kinds too: bot groups with open threads
  // sort by their first open thread, fully-resolved groups sink.
  const rowsOut: DigestRow[] = [...humans, ...botGroups];
  rowsOut.sort((left, right) => {
    const leftRow =
      left.kind === DigestRowKinds.THREAD ? left : left.threads[0];
    const rightRow =
      right.kind === DigestRowKinds.THREAD ? right : right.threads[0];
    if (leftRow === undefined || rightRow === undefined) return 0;
    const leftOpen =
      left.kind === DigestRowKinds.THREAD
        ? !left.thread.isResolved
        : left.openCount > 0;
    const rightOpen =
      right.kind === DigestRowKinds.THREAD
        ? !right.thread.isResolved
        : right.openCount > 0;
    if (leftOpen !== rightOpen) return leftOpen ? -1 : 1;
    return compareRows(leftRow, rightRow);
  });
  return rowsOut;
}

/** Build the digest groups: chunks in reading order, then outdated, then general. */
type DigestGroupLabel = (
  kind: typeof DigestGroupKinds.OUTDATED | typeof DigestGroupKinds.GENERAL,
) => string;

function appendPlacedThread(
  byChunk: Map<string, DigestThreadRow[]>,
  chunks: readonly BriefChunk[],
  thread: ConversationThread,
  row: DigestThreadRow,
  placement: FileOrChunkPlacement,
): void {
  const matchingChunks =
    placement.kind === ThreadPlacementKinds.FILE_HEADER
      ? chunks.filter((chunk) => chunk.file === thread.path)
      : chunks.filter((chunk) => chunk.id === placement.chunkId);

  for (const chunk of matchingChunks) {
    const list = byChunk.get(chunk.id) ?? [];

    if (placement.kind === ThreadPlacementKinds.FILE_HEADER) {
      const headerRow: DigestThreadRow = {
        ...row,
        placement: {
          kind: ThreadPlacementKinds.FILE_HEADER,
          chunkId: chunk.id,
        },
      };
      list.push(headerRow);
    } else {
      list.push(row);
    }

    byChunk.set(chunk.id, list);
  }
}

function collectDigestGroups(
  input: BuildConversationDigestInput,
  labelFor: DigestGroupLabel,
): DigestGroup[] {
  const { conversation, chunks, ownThreadIds, briefGeneratedAt } = input;
  const byChunk = new Map<string, DigestThreadRow[]>();
  const outdated: DigestThreadRow[] = [];
  const general: DigestThreadRow[] = [];

  for (const thread of conversation.threads) {
    const placement = placeThread(thread, chunks);
    const row = threadRow(thread, placement, ownThreadIds, briefGeneratedAt);
    if (
      placement.kind === ThreadPlacementKinds.CHUNK ||
      placement.kind === ThreadPlacementKinds.FILE_HEADER
    ) {
      appendPlacedThread(byChunk, chunks, thread, row, placement);
    } else if (placement.reason === UnanchoredReasons.OUTDATED) {
      outdated.push(row);
    } else {
      general.push(row);
    }
  }

  const groups: DigestGroup[] = [];
  for (const chunk of chunks) {
    const rows = byChunk.get(chunk.id);
    if (rows === undefined || rows.length === 0) continue;
    groups.push({
      id: `chunk:${chunk.id}`,
      kind: DigestGroupKinds.CHUNK,
      label: chunk.file,
      chunkId: chunk.id,
      rows: toRows(rows.toSorted(compareRows)),
    });
  }
  if (outdated.length > 0) {
    groups.push({
      id: DigestGroupKinds.OUTDATED,
      kind: DigestGroupKinds.OUTDATED,
      label: labelFor(DigestGroupKinds.OUTDATED),
      rows: toRows(outdated.toSorted(compareRows)),
    });
  }
  if (general.length > 0 || conversation.prComments.length > 0) {
    groups.push({
      id: DigestGroupKinds.GENERAL,
      kind: DigestGroupKinds.GENERAL,
      label: labelFor(DigestGroupKinds.GENERAL),
      rows: toRows(general.toSorted(compareRows)),
      prComments: conversation.prComments,
    });
  }
  return groups;
}

/**
 * Fresh human threads remain inline even when resolved. Bot disclosures inline only
 * unresolved threads; resolved/outdated bots stay in the digest. Unanchored threads
 * never float mid-code. Reuse the digest's sorted rows.
 */
export function buildConversationDigest(
  t: TFunction,
  input: BuildConversationDigestInput,
): DigestGroup[] {
  return collectDigestGroups(input, (kind) =>
    kind === DigestGroupKinds.OUTDATED
      ? t("conversation.digestOutdated")
      : t("conversation.digestGeneral"),
  );
}

export function buildInlineThreads(
  input: BuildConversationDigestInput,
): Map<string, DigestRow[]> {
  // Inline threads read only the chunk groups; the labels never render.
  const groups = collectDigestGroups(input, () => "");
  const byChunk = new Map<string, DigestRow[]>();
  for (const group of groups) {
    if (group.kind !== DigestGroupKinds.CHUNK || group.chunkId === undefined) {
      continue;
    }
    const rows = selectInlineRows(group.rows);
    if (rows.length > 0) byChunk.set(group.chunkId, rows);
  }
  return byChunk;
}

/** The digest rows that render inline at a chunk, in digest order. */
function selectInlineRows(rows: readonly DigestRow[]): DigestRow[] {
  const inline: DigestRow[] = [];
  for (const row of rows) {
    if (row.kind === DigestRowKinds.THREAD) {
      if (!row.thread.isOutdated) inline.push(row);
      continue;
    }
    const openThreads = row.threads.filter(
      (botThread) =>
        !botThread.thread.isResolved && !botThread.thread.isOutdated,
    );
    if (openThreads.length > 0) {
      inline.push({
        ...row,
        threads: openThreads,
        openCount: openThreads.length,
      });
    }
  }
  return inline;
}

export interface InlineRowSplit {
  /** Human threads keyed by their diff-row index, rendered UNDER the row. */
  readonly byRow: ReadonlyMap<number, DigestThreadRow[]>;
  /** FILE threads for the ChunkCard header band, not a diff row. */
  readonly fileHeader: readonly DigestThreadRow[];
  /** Bot groups, ONE aggregated chunk-level disclosure per bot. */
  readonly botGroups: readonly DigestBotGroupRow[];
}

/**
 * Split a chunk's inline rows for rendering: human threads go row-level
 * inside the diff, under the exact line they discuss, while bots keep the
 * single aggregated disclosure (bots under every line would rebuild the wall
 * the digest collapses).
 */
export function splitInlineRows(rows: readonly DigestRow[]): InlineRowSplit {
  const byRow = new Map<number, DigestThreadRow[]>();
  const fileHeader: DigestThreadRow[] = [];
  const botGroups: DigestBotGroupRow[] = [];
  for (const row of rows) {
    if (row.kind === DigestRowKinds.BOT_GROUP) {
      botGroups.push(row);
      continue;
    }
    if (row.placement.kind === ThreadPlacementKinds.FILE_HEADER) {
      fileHeader.push(row);
      continue;
    }
    if (row.placement.kind !== ThreadPlacementKinds.CHUNK) continue;
    const index = Number(row.placement.rowId.split(":").at(-1));
    if (Number.isNaN(index)) continue;
    const list = byRow.get(index) ?? [];
    list.push(row);
    byRow.set(index, list);
  }
  return { byRow, fileHeader, botGroups };
}
