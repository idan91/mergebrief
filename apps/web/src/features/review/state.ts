import { Roles, type BriefChunk } from "../brief/types";
import type { RiskFlag } from "../brief/viewModel";
import type { ReviewComment } from "./comments";

export type FlagStatus = "open" | "addressed" | "dismissed";
export type ReviewMode = "reviewer" | "author";
export type ReviewOutcome = "comment" | "approve" | "request-changes";
export type RiskEvidenceKind = "linked-comment" | "chunk-reviewed" | "manual-note";
export type UnresolvedItemKind = "open-risk" | "missing-evidence" | "unreviewed-carrier" | "draft-comment" | "thin-dismissal";

export interface FlagState {
  status: FlagStatus;
  reason: string;
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
  flagStates: Record<string, FlagState>;
  riskEvidence: Record<string, RiskEvidence>;
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

export function riskEvidenceLabel(evidence: RiskEvidence, comments: ReviewComment[], chunks: BriefChunk[]): string {
  if (evidence.kind === "linked-comment") {
    const comment = comments.find((item) => item.id === evidence.commentId);
    if (!comment) return "linked comment";
    return `linked comment ${comment.anchor.file}:${comment.anchor.side === "new" ? "+" : "-"}${comment.anchor.startLine}`;
  }
  if (evidence.kind === "chunk-reviewed") {
    const chunk = chunks.find((item) => item.id === evidence.chunkId);
    return `reviewed related chunk ${chunk?.file ?? "selected chunk"}`;
  }
  const note = evidence.note?.trim();
  return note ? `manually verified: ${note}` : "manually verified";
}

export function deriveUnresolvedItems(input: UnresolvedInput): UnresolvedItem[] {
  const items: UnresolvedItem[] = [];

  for (const flag of input.flags) {
    const state = input.flagStates[flag.id] ?? { status: "open", reason: "" };
    const label = `${flag.attr} @ ${flag.file}`;
    if (state.status === "open") {
      items.push({ id: `risk:${flag.id}`, kind: "open-risk", label, targetId: flag.chunkId });
      continue;
    }
    if (state.status === "addressed" && !input.riskEvidence[flag.id]) {
      items.push({ id: `evidence:${flag.id}`, kind: "missing-evidence", label, targetId: flag.chunkId });
      continue;
    }
    if (state.status === "dismissed" && isThinReason(state.reason)) {
      items.push({ id: `dismissal:${flag.id}`, kind: "thin-dismissal", label, targetId: flag.chunkId });
    }
  }

  for (const chunk of input.chunks) {
    if (chunk.role === Roles.Carrier && !input.reviewedChunkIds.has(chunk.id)) {
      items.push({ id: `carrier:${chunk.id}`, kind: "unreviewed-carrier", label: chunk.file, targetId: chunk.id });
    }
  }

  for (const comment of input.comments) {
    if (comment.status === "draft") {
      items.push({ id: `comment:${comment.id}`, kind: "draft-comment", label: commentLocation(comment), targetId: comment.anchor.chunkId });
    }
  }

  return items;
}

export function summarySignatureLine(counts: SignatureCounts): string {
  return `Reviewed with Brief / review — summary: ${counts.reviewedChunks} chunks read, ${counts.addressedRisks} risks addressed, ${counts.dismissedRisks} dismissed.`;
}

export function riskDispositionCounts(flagStates: Record<string, FlagState>, flagIds: string[]): RiskDispositionCounts {
  return flagIds.reduce<RiskDispositionCounts>(
    (counts, flagId) => {
      const status = flagStates[flagId]?.status ?? "open";
      if (status === "addressed") return { ...counts, addressed: counts.addressed + 1 };
      if (status === "dismissed") return { ...counts, dismissed: counts.dismissed + 1 };
      return { ...counts, open: counts.open + 1 };
    },
    { addressed: 0, dismissed: 0, open: 0 },
  );
}

export function isThinReason(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length > 0 && trimmed.length < 12;
}

export function commentLocation(comment: ReviewComment): string {
  const sign = comment.anchor.side === "new" ? "+" : "-";
  const range = comment.anchor.startLine === comment.anchor.endLine ? `${sign}${comment.anchor.startLine}` : `${sign}${comment.anchor.startLine}-${comment.anchor.endLine}`;
  return `${comment.anchor.file}:${range}`;
}
