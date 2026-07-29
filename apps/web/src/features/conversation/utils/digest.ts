// Digest view-model builder (BRIEF-25, locked decisions 5/6): the
// conversation organized by the BRIEF'S structure — threads grouped by chunk
// in reading order, unresolved first — not GitHub's chronological feed.
// Bot walls collapse, never hide: humans get one row per thread; bots one
// aggregated row per (bot author, chunk group), expandable to per-thread
// rows. Outdated threads live in a revision-labeled group (their anchor-time
// coordinates are never trusted); unanchored fresh threads and PR-level
// comments form the general group. Sorting never reads bot self-assigned
// severity — that prose stays inside comment bodies.
import type { BriefChunk } from "../../brief/types";
import { placeThread, type ThreadPlacement } from "./anchor";
import { deriveDigestLine } from "./digestLine";
import type {
  ConversationThread,
  PrConversation,
  PrLevelComment,
} from "../types";

export interface DigestThreadRow {
  readonly kind: "thread";
  readonly thread: ConversationThread;
  /** The one-liner for the row (digest-line spec over the root body). */
  readonly digestLine: string;
  readonly placement: ThreadPlacement;
  /** True when the thread came from this reviewer's recorded submits. */
  readonly isOwn: boolean;
  /** Short anchor revision label — outdated rows only. */
  readonly anchorLabel?: string;
  /**
   * The viewed revision's generation cutoff (BRIEF-95), stamped on every
   * row so the detail renderers — section and inline alike — can mark
   * comments that postdate the brief without new prop plumbing.
   */
  readonly briefGeneratedAt?: string;
}

export interface DigestBotGroupRow {
  readonly kind: "bot-group";
  readonly author: string;
  /** Per-thread rows revealed on expand, already sorted. */
  readonly threads: readonly DigestThreadRow[];
  readonly openCount: number;
}

export type DigestRow = DigestThreadRow | DigestBotGroupRow;

export interface DigestGroup {
  /** Stable id for expansion bookkeeping: `chunk:<id>` | `outdated` | `general`. */
  readonly id: string;
  readonly kind: "chunk" | "outdated" | "general";
  readonly label: string;
  readonly chunkId?: string;
  readonly rows: readonly DigestRow[];
  /** PR-level (issue) comments — general group only. */
  readonly prComments?: readonly PrLevelComment[];
}

export interface BuildConversationDigestInput {
  readonly conversation: PrConversation;
  readonly chunks: readonly BriefChunk[];
  readonly ownThreadIds: ReadonlySet<number>;
  /** The viewed revision's generation cutoff (BRIEF-95); absent marks nothing. */
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
  return {
    kind: "thread",
    thread,
    digestLine: deriveDigestLine(rootBody),
    placement,
    isOwn: ownThreadIds.has(thread.rootCommentId),
    ...(anchorLabel === undefined ? {} : { anchorLabel }),
    ...(briefGeneratedAt === undefined ? {} : { briefGeneratedAt }),
  };
}

/**
 * The row index inside the chunk's diff (from `rowId` = `chunkId:index`) —
 * the ONE reading-order axis. LEFT old-line and RIGHT new-line numbers are
 * not comparable (codex round 1); the placement already resolved both to a
 * row position.
 */
function placementRowIndex(row: DigestThreadRow): number {
  if (row.placement.kind !== "chunk") return Number.MAX_SAFE_INTEGER;
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
      kind: "bot-group",
      author,
      threads,
      openCount: threads.filter((row) => !row.thread.isResolved).length,
    }),
  );
  // Unresolved-first applies across kinds too: bot groups with open threads
  // sort by their first open thread, fully-resolved groups sink.
  const rowsOut: DigestRow[] = [...humans, ...botGroups];
  rowsOut.sort((left, right) => {
    const leftRow = left.kind === "thread" ? left : left.threads[0];
    const rightRow = right.kind === "thread" ? right : right.threads[0];
    if (leftRow === undefined || rightRow === undefined) return 0;
    const leftOpen =
      left.kind === "thread" ? !left.thread.isResolved : left.openCount > 0;
    const rightOpen =
      right.kind === "thread" ? !right.thread.isResolved : right.openCount > 0;
    if (leftOpen !== rightOpen) return leftOpen ? -1 : 1;
    return compareRows(leftRow, rightRow);
  });
  return rowsOut;
}

/** Build the digest groups: chunks in reading order, then outdated, then general. */
export function buildConversationDigest(
  input: BuildConversationDigestInput,
): DigestGroup[] {
  const { conversation, chunks, ownThreadIds, briefGeneratedAt } = input;
  const byChunk = new Map<string, DigestThreadRow[]>();
  const outdated: DigestThreadRow[] = [];
  const general: DigestThreadRow[] = [];

  for (const thread of conversation.threads) {
    const placement = placeThread(thread, chunks);
    const row = threadRow(thread, placement, ownThreadIds, briefGeneratedAt);
    if (placement.kind === "chunk") {
      const list = byChunk.get(placement.chunkId) ?? [];
      list.push(row);
      byChunk.set(placement.chunkId, list);
    } else if (placement.reason === "outdated") {
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
      kind: "chunk",
      label: chunk.file,
      chunkId: chunk.id,
      rows: toRows(rows.toSorted(compareRows)),
    });
  }
  if (outdated.length > 0) {
    groups.push({
      id: "outdated",
      kind: "outdated",
      label: "Outdated — anchored on earlier revisions",
      rows: toRows(outdated.toSorted(compareRows)),
    });
  }
  if (general.length > 0 || conversation.prComments.length > 0) {
    groups.push({
      id: "general",
      kind: "general",
      label: "Pull-request conversation",
      rows: toRows(general.toSorted(compareRows)),
      prComments: conversation.prComments,
    });
  }
  return groups;
}

/**
 * Inline placement (locked decision 6): what renders AT a chunk, as opposed
 * to the digest. Fresh human threads inline per-thread (resolved ones too —
 * they collapse visually, they don't hide); bots inline as ONE aggregated
 * disclosure per bot carrying only their UNRESOLVED threads — resolved and
 * outdated bot threads are digest-only, and nothing unanchored ever floats
 * mid-code. Rows reuse the digest's sorted view-model.
 */
export function buildInlineThreads(
  input: BuildConversationDigestInput,
): Map<string, DigestRow[]> {
  const groups = buildConversationDigest(input);
  const byChunk = new Map<string, DigestRow[]>();
  for (const group of groups) {
    if (group.kind !== "chunk" || group.chunkId === undefined) continue;
    const rows: DigestRow[] = [];
    for (const row of group.rows) {
      if (row.kind === "thread") {
        if (!row.thread.isOutdated) rows.push(row);
        continue;
      }
      const openThreads = row.threads.filter(
        (botThread) =>
          !botThread.thread.isResolved && !botThread.thread.isOutdated,
      );
      if (openThreads.length > 0) {
        rows.push({
          ...row,
          threads: openThreads,
          openCount: openThreads.length,
        });
      }
    }
    if (rows.length > 0) byChunk.set(group.chunkId, rows);
  }
  return byChunk;
}

export interface InlineRowSplit {
  /** Human threads keyed by their diff-row index — rendered UNDER the row. */
  readonly byRow: ReadonlyMap<number, DigestThreadRow[]>;
  /** Bot groups — ONE aggregated chunk-level disclosure per bot. */
  readonly botGroups: readonly DigestBotGroupRow[];
}

/**
 * Split a chunk's inline rows for rendering (Idan, smoke feedback
 * 2026-07-08): human threads go row-level inside the diff — under the exact
 * line they discuss, like the artifact's addressed-comments display — while
 * bots keep the single aggregated disclosure (bots under every line would
 * rebuild the wall the digest collapses).
 */
export function splitInlineRows(rows: readonly DigestRow[]): InlineRowSplit {
  const byRow = new Map<number, DigestThreadRow[]>();
  const botGroups: DigestBotGroupRow[] = [];
  for (const row of rows) {
    if (row.kind === "bot-group") {
      botGroups.push(row);
      continue;
    }
    if (row.placement.kind !== "chunk") continue;
    const index = Number(row.placement.rowId.split(":").at(-1));
    if (Number.isNaN(index)) continue;
    const list = byRow.get(index) ?? [];
    list.push(row);
    byRow.set(index, list);
  }
  return { byRow, botGroups };
}
