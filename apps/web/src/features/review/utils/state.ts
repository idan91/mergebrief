import type { TFunction } from "i18next";
import { Roles } from "brief-core/types";
import { AttentionItemKinds, type AttentionItemKind } from "contract";
import {
  type BriefChunk,
  isUnattributedRemainderChunk,
  type RiskFlag,
} from "@web/features/brief/model";
import { CommentAnchorKinds } from "types/comments";
import {
  ReviewCommentStatuses,
  resolveJumpChunkId,
  isFileCommentAnchor,
  isLineCommentAnchor,
  type ReviewComment,
} from "./comments";
import type { Disposition } from "../session/disposition";
import type { SessionAttentionItem } from "../session/attention";
import { UnresolvedItemKinds, type UnresolvedItemKind } from "./types";

export type ReviewOutcome = "comment" | "approve" | "request-changes";
export type RiskEvidenceKind =
  | "linked-comment"
  | "chunk-reviewed"
  | "manual-note";

/**
 * @description A batch of flags a dismiss modal is open FOR, with its display
 * label. Owned here (disposition domain): the modal renders it, the flow
 * store holds it, neither may reach into the other's subtree.
 */
export interface DismissTarget {
  flagIds: string[];
  label: string;
}

/** @description The address-with-evidence twin of {@link DismissTarget}. */
export interface EvidenceTarget {
  flagIds: string[];
  label: string;
}

export interface RiskEvidence {
  kind: RiskEvidenceKind;
  commentId?: string;
  chunkId?: string;
  note?: string;
}

export interface UnresolvedInput {
  chunks: BriefChunk[];
  /** View-model remainder chunks (`kind`), never selected by role. */
  remainderChunks: BriefChunk[];
  flags: RiskFlag[];
  dispositions: Record<string, Disposition>;
  reviewedChunkIds: Set<string>;
  comments: ReviewComment[];
}

export interface UnresolvedItem {
  id: string;
  kind: UnresolvedItemKind;
  label: string;
  targetId: string;
}

export interface SignatureCounts {
  reviewedChunks: number;
  addressedRisks: number;
  dismissedRisks: number;
}

export interface RiskDispositionCounts {
  addressed: number;
  dismissed: number;
  open: number;
}

/** A chunk's whole diff span, the region a flag's disposition anchors on. */
export interface ChunkRegion {
  start: number;
  end: number;
}

export function getChunkRegion(chunk: BriefChunk): ChunkRegion {
  const bounds = [...chunk.addedRanges, ...chunk.removedRanges];
  if (bounds.length === 0) {
    return { start: 1, end: 1 };
  }
  return {
    start: Math.min(...bounds.map((range) => range.start)),
    end: Math.max(...bounds.map((range) => range.end)),
  };
}

export function riskEvidenceLabel(
  t: TFunction,
  evidence: RiskEvidence,
  comments: ReviewComment[],
  chunks: BriefChunk[],
): string {
  if (evidence.kind === "linked-comment") {
    const comment = comments.find((item) => item.id === evidence.commentId);
    if (!comment) {
      return t("review.summary.evidenceLinkedCommentMissing");
    }
    return t("review.summary.evidenceLinkedComment", {
      location: commentLocation(comment),
    });
  }
  if (evidence.kind === "chunk-reviewed") {
    const chunk = chunks.find((item) => item.id === evidence.chunkId);
    return t("review.summary.evidenceChunkReviewed", {
      file: chunk?.file ?? t("review.summary.evidenceSelectedChunk"),
    });
  }
  const note = evidence.note?.trim();
  return note
    ? t("review.summary.evidenceManualWithNote", { note })
    : t("review.summary.evidenceManual");
}

export function deriveUnresolvedItems(
  input: UnresolvedInput,
): UnresolvedItem[] {
  const items: UnresolvedItem[] = [];
  const remainderChunks = input.remainderChunks;
  const remainderIds = new Set(remainderChunks.map((chunk) => chunk.id));

  for (const flag of input.flags) {
    const disposition = input.dispositions[flag.id] ?? { kind: "open" };
    const label = `${flag.attr} @ ${flag.file}`;
    if (disposition.kind === "open") {
      items.push({
        id: `risk:${flag.id}`,
        kind: UnresolvedItemKinds.OPEN_RISK,
        label,
        targetId: flag.chunkId,
      });
      continue;
    }
    if (disposition.kind === "addressed" && !disposition.evidence) {
      items.push({
        id: `evidence:${flag.id}`,
        kind: UnresolvedItemKinds.MISSING_EVIDENCE,
        label,
        targetId: flag.chunkId,
      });
      continue;
    }
    if (disposition.kind === "dismissed" && isThinReason(disposition.reason)) {
      items.push({
        id: `dismissal:${flag.id}`,
        kind: UnresolvedItemKinds.THIN_DISMISSAL,
        label,
        targetId: flag.chunkId,
      });
    }
  }

  for (const chunk of input.chunks) {
    if (remainderIds.has(chunk.id) || isUnattributedRemainderChunk(chunk)) {
      continue;
    }
    if (chunk.role === Roles.CORE && !input.reviewedChunkIds.has(chunk.id)) {
      items.push({
        id: `core:${chunk.id}`,
        kind: UnresolvedItemKinds.UNREVIEWED_CORE,
        label: chunk.file,
        targetId: chunk.id,
      });
    }
  }

  for (const chunk of remainderChunks) {
    if (input.reviewedChunkIds.has(chunk.id)) {
      continue;
    }
    items.push({
      id: `remainder:${chunk.id}`,
      kind: UnresolvedItemKinds.UNREVIEWED_REMAINDER,
      label: chunk.file,
      targetId: chunk.id,
    });
  }

  for (const comment of input.comments) {
    if (comment.status === ReviewCommentStatuses.DRAFT) {
      items.push({
        id: `comment:${comment.id}`,
        kind: UnresolvedItemKinds.DRAFT_COMMENT,
        label: commentLocation(comment),
        targetId: resolveJumpChunkId(comment, input.chunks),
      });
    }
  }

  return items;
}

/**
 * A carried item: the submit list's shape plus what the server said about it.
 * `clearedBy` is carried verbatim, the operations that clear an item are the
 * server's answer, never a table the client keeps.
 */
export interface CarriedItem extends Omit<UnresolvedItem, "kind"> {
  /** The three carried kinds, never the submit list's own. */
  kind: AttentionItemKind;
  clearedBy: readonly string[];
  /**
   * What a clearing operation acts on here: the draft row's id, or the
   * brief-local flag id whose disposition the item is about.
   */
  actionTargetId: string;
  /** This Brief renders nothing for the item's file, there is no jump. */
  unplaceable: boolean;
  /** What the jump reads: the flag's file, or the draft's location. */
  locationLabel: string;
  /** The flag's risk attribute; absent on a draft. */
  attribute?: string;
}

export interface CarriedInput {
  attention: readonly SessionAttentionItem[];
  chunks: BriefChunk[];
  /** The session's one chunk-to-region map, keyed by chunk id. */
  regions: ReadonlyMap<string, ChunkRegion>;
  flags: RiskFlag[];
  dispositions: Record<string, Disposition>;
  comments: ReviewComment[];
  /** Carried drafts deleted from the list that no chunk could hold. */
  deletedMissingDrafts: ReadonlySet<string>;
}

/** The anchor a stored disposition keys on, as both resolutions read it. */
export interface FlagAnchor {
  filePath: string;
  attribute: string | null;
  startLine: number;
  endLine: number;
}

/**
 * Does this flag sit under that anchor? OVERLAP, not equality: a carried
 * decision is remapped to the lines it landed on, and chunk boundaries are
 * re-derived per Brief, so demanding an exact region would silently drop a
 * decision the server still holds. ONE predicate for both resolutions, the
 * store's and the attention list's, or the row claims nothing needs a
 * re-look while the server's list says otherwise.
 */
export function isFlagUnderAnchor(
  flag: RiskFlag,
  region: ChunkRegion | undefined,
  anchor: FlagAnchor,
): boolean {
  if (flag.file !== anchor.filePath || flag.attr !== anchor.attribute) {
    return false;
  }
  if (region === undefined) {
    return false;
  }
  return region.start <= anchor.endLine && region.end >= anchor.startLine;
}

/** The flags an attention item's anchor covers by file, attribute and region. */
function getFlagsAtAnchor(
  input: CarriedInput,
  item: SessionAttentionItem,
): RiskFlag[] {
  const { location } = item;
  if (location.kind !== CommentAnchorKinds.LINE) {
    return [];
  }
  return input.flags.filter((flag) =>
    isFlagUnderAnchor(flag, input.regions.get(flag.chunkId), {
      filePath: location.filePath,
      attribute: item.subject.attribute,
      startLine: location.startLine,
      endLine: location.endLine,
    }),
  );
}

/** Is a disposition item still asking for the decision it was raised for? */
function isDispositionPending(
  kind: AttentionItemKind,
  disposition: Disposition,
): boolean {
  if (kind === AttentionItemKinds.REOPENED_DISPOSITION) {
    return disposition.kind === "open";
  }
  return disposition.kind === "addressed" && disposition.evidence === undefined;
}

function buildCarriedDraftItem(
  input: CarriedInput,
  item: SessionAttentionItem,
): CarriedItem | undefined {
  const id = item.subject.id;
  if (id === null) {
    return undefined;
  }
  const live = input.comments.find(
    (comment) =>
      comment.id === id && comment.status === ReviewCommentStatuses.DRAFT,
  );
  if (live !== undefined) {
    // Re-anchored: the draft the reviewer re-placed no longer sits where the
    // carry-over left it, and the item is what asked them to move it.
    if (hasDraftMovedFromAttention(live, item)) {
      return undefined;
    }
    return {
      id: `carried:${id}`,
      kind: AttentionItemKinds.ORPHANED_ANCHOR,
      label: commentLocation(live),
      targetId: resolveJumpChunkId(live, input.chunks),
      clearedBy: item.clearedBy,
      actionTargetId: id,
      unplaceable: false,
      locationLabel: commentLocation(live),
    };
  }
  // No live draft: deleted (cleared) unless this Brief never had a row to put
  // it on, which is the case the item exists to surface.
  const renders = input.chunks.some(
    (chunk) => chunk.file === item.location.filePath,
  );
  if (renders || input.deletedMissingDrafts.has(id)) {
    return undefined;
  }
  return {
    id: `carried:${id}`,
    kind: AttentionItemKinds.ORPHANED_ANCHOR,
    label: formatAttentionLocationLabel(item.location),
    targetId: "",
    clearedBy: item.clearedBy,
    actionTargetId: id,
    unplaceable: true,
    locationLabel: formatAttentionLocationLabel(item.location),
  };
}

function hasDraftMovedFromAttention(
  live: ReviewComment,
  item: SessionAttentionItem,
): boolean {
  const { location } = item;
  if (location.kind === CommentAnchorKinds.FILE) {
    return live.anchor.file !== location.filePath;
  }
  if (!isLineCommentAnchor(live.anchor)) {
    return true;
  }
  return (
    live.anchor.startLine !== location.startLine ||
    live.anchor.endLine !== location.endLine
  );
}

function formatAttentionLocationLabel(
  location: SessionAttentionItem["location"],
): string {
  if (location.kind === CommentAnchorKinds.FILE) {
    return location.filePath;
  }
  return `${location.filePath}:${String(location.startLine)}`;
}

function buildCarriedDispositionItem(
  input: CarriedInput,
  item: SessionAttentionItem,
): CarriedItem | undefined {
  const pending = getFlagsAtAnchor(input, item).find((flag) =>
    isDispositionPending(
      item.kind,
      input.dispositions[flag.id] ?? { kind: "open" },
    ),
  );
  if (pending === undefined) {
    return undefined;
  }
  return {
    id: `carried:${item.kind}:${pending.id}`,
    kind: item.kind,
    label: `${pending.attr} @ ${pending.file}`,
    targetId: pending.chunkId,
    clearedBy: item.clearedBy,
    actionTargetId: pending.id,
    unplaceable: false,
    locationLabel: pending.file,
    attribute: pending.attr,
  };
}

/**
 * The attention list: the server's carried verdicts, minus the ones the
 * reviewer has since cleared in this tab.
 *
 * A SECOND derivation, never a merge with {@link deriveUnresolvedItems}:
 * every kind that one raises fires on a first-ever review, so a merged list
 * would make the carry-over row claim work that never carried. Clearing is
 * read off live state rather than tracked, so a write that fails and reverts
 * puts its item straight back.
 */
export function deriveCarriedItems(input: CarriedInput): CarriedItem[] {
  return input.attention.flatMap((item) => {
    const derived =
      item.kind === AttentionItemKinds.ORPHANED_ANCHOR
        ? buildCarriedDraftItem(input, item)
        : buildCarriedDispositionItem(input, item);
    return derived === undefined ? [] : [derived];
  });
}

/** Display label for a review outcome (the SubmitModal picker). */
export function reviewOutcomeLabel(
  t: TFunction,
  outcome: ReviewOutcome,
): string {
  if (outcome === "request-changes") {
    return t("review.outcome.requestChanges");
  }
  if (outcome === "approve") {
    return t("review.outcome.approve");
  }
  return t("review.outcome.comment");
}

/**
 * The PREVIEW's signature line. The one actually posted to GitHub lives in
 * `submit.ts` and stays English, it is written into an external system, not
 * rendered to the viewer.
 */
export function summarySignatureLine(
  t: TFunction,
  counts: SignatureCounts,
): string {
  return t("review.summary.signature", {
    reviewedChunks: counts.reviewedChunks,
    addressedRisks: counts.addressedRisks,
    dismissedRisks: counts.dismissedRisks,
  });
}

export function riskDispositionCounts(
  dispositions: Record<string, Disposition>,
  flagIds: string[],
): RiskDispositionCounts {
  const counts: RiskDispositionCounts = { addressed: 0, dismissed: 0, open: 0 };
  for (const flagId of flagIds) {
    const kind = dispositions[flagId]?.kind ?? "open";
    if (kind === "addressed") {
      counts.addressed += 1;
    } else if (kind === "dismissed") {
      counts.dismissed += 1;
    } else {
      counts.open += 1;
    }
  }
  return counts;
}

export function isThinReason(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length > 0 && trimmed.length < 12;
}

export function commentLocation(comment: ReviewComment): string {
  const { anchor } = comment;
  if (isFileCommentAnchor(anchor)) {
    return anchor.file;
  }
  const sign = anchor.side === "new" ? "+" : "-";
  if (anchor.startSide !== undefined && anchor.startSide !== anchor.side) {
    const startSign = anchor.startSide === "new" ? "+" : "-";
    return `${anchor.file}:${startSign}${anchor.startLine}→${sign}${anchor.endLine}`;
  }
  const range =
    anchor.startLine === anchor.endLine
      ? `${sign}${anchor.startLine}`
      : `${sign}${anchor.startLine}-${anchor.endLine}`;
  return `${anchor.file}:${range}`;
}
