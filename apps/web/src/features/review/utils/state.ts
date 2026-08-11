import type { TFunction } from "i18next";
import { Roles, type BriefChunk } from "../../brief/types";
import type { RiskFlag } from "@web/features/brief/utils";
import type { ReviewComment } from "./comments";
import type { Disposition } from "../session/disposition";

export type ReviewOutcome = "comment" | "approve" | "request-changes";
export type RiskEvidenceKind =
  | "linked-comment"
  | "chunk-reviewed"
  | "manual-note";
export type UnresolvedItemKind =
  | "open-risk"
  | "missing-evidence"
  | "unreviewed-core"
  | "draft-comment"
  | "thin-dismissal";

/**
 * @description A batch of flags a dismiss modal is open FOR, with its display
 * label. Owned here (disposition domain): the modal renders it, the flow
 * store holds it — neither may reach into the other's subtree.
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

export function riskEvidenceLabel(
  t: TFunction,
  evidence: RiskEvidence,
  comments: ReviewComment[],
  chunks: BriefChunk[],
): string {
  if (evidence.kind === "linked-comment") {
    const comment = comments.find((item) => item.id === evidence.commentId);
    if (!comment) return t("review.summary.evidenceLinkedCommentMissing");
    return t("review.summary.evidenceLinkedComment", {
      location: `${comment.anchor.file}:${comment.anchor.side === "new" ? "+" : "-"}${comment.anchor.startLine}`,
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

  for (const flag of input.flags) {
    const disposition = input.dispositions[flag.id] ?? { kind: "open" };
    const label = `${flag.attr} @ ${flag.file}`;
    if (disposition.kind === "open") {
      items.push({
        id: `risk:${flag.id}`,
        kind: "open-risk",
        label,
        targetId: flag.chunkId,
      });
      continue;
    }
    if (disposition.kind === "addressed" && !disposition.evidence) {
      items.push({
        id: `evidence:${flag.id}`,
        kind: "missing-evidence",
        label,
        targetId: flag.chunkId,
      });
      continue;
    }
    if (disposition.kind === "dismissed" && isThinReason(disposition.reason)) {
      items.push({
        id: `dismissal:${flag.id}`,
        kind: "thin-dismissal",
        label,
        targetId: flag.chunkId,
      });
    }
  }

  for (const chunk of input.chunks) {
    if (chunk.role === Roles.CORE && !input.reviewedChunkIds.has(chunk.id)) {
      items.push({
        id: `core:${chunk.id}`,
        kind: "unreviewed-core",
        label: chunk.file,
        targetId: chunk.id,
      });
    }
  }

  for (const comment of input.comments) {
    if (comment.status === "draft") {
      items.push({
        id: `comment:${comment.id}`,
        kind: "draft-comment",
        label: commentLocation(comment),
        targetId: comment.anchor.chunkId,
      });
    }
  }

  return items;
}

/** Display label for a review outcome (SubmitModal picker, SummaryPreview). */
export function reviewOutcomeLabel(
  t: TFunction,
  outcome: ReviewOutcome,
): string {
  if (outcome === "request-changes") return t("review.outcome.requestChanges");
  if (outcome === "approve") return t("review.outcome.approve");
  return t("review.outcome.comment");
}

/**
 * The PREVIEW's signature line. The one actually posted to GitHub lives in
 * `submit.ts` and stays English — it is written into an external system, not
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
    if (kind === "addressed") counts.addressed += 1;
    else if (kind === "dismissed") counts.dismissed += 1;
    else counts.open += 1;
  }
  return counts;
}

export function isThinReason(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length > 0 && trimmed.length < 12;
}

export function commentLocation(comment: ReviewComment): string {
  const sign = comment.anchor.side === "new" ? "+" : "-";
  const range =
    comment.anchor.startLine === comment.anchor.endLine
      ? `${sign}${comment.anchor.startLine}`
      : `${sign}${comment.anchor.startLine}-${comment.anchor.endLine}`;
  return `${comment.anchor.file}:${range}`;
}
