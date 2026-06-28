import type { Brief } from "../brief/types";
import type { BriefViewModel } from "../brief/viewModel";
import type { CommentSide } from "./comments";
import type { SessionSnapshot } from "./session";
import {
  riskDispositionCounts,
  riskEvidenceLabel,
  type RiskDispositionCounts,
  type RiskEvidence,
} from "./state";

/**
 * The Receipt (ADR 0002) as a structured value, not a rendered string. Built
 * from the frozen session snapshot so both the in-app ReceiptDrawer and the
 * static Review Summary render the same content their own way. Carries the real
 * disposition data (evidence / reason) rather than pre-formatted text, so each
 * consumer keeps its own labelling and fallbacks. No invented "mechanical
 * verified" buckets — only data that actually exists (defer-don't-fake).
 */
export interface ReceiptAddressedFlag {
  attr: string;
  file: string;
  /** Resolved per-flag evidence, when present (addressed-pending-evidence omits it). */
  evidence?: RiskEvidence;
  /** Shared human label for the evidence; consumers supply their own empty fallback. */
  evidenceLabel?: string;
}

export interface ReceiptDismissedFlag {
  attr: string;
  file: string;
  /** The reviewer's reason, verbatim. */
  reason: string;
}

export interface ReceiptOpenFlag {
  attr: string;
  file: string;
}

export interface ReceiptComment {
  id: string;
  file: string;
  side: CommentSide;
  startLine: number;
  endLine: number;
  firstLine: string;
}

export interface Receipt {
  subject: { repo: string; number: number; sha: string };
  progress: { reviewedChunks: number; chunkTotal: number; flagTotal: number };
  counts: RiskDispositionCounts;
  addressed: ReceiptAddressedFlag[];
  dismissed: ReceiptDismissedFlag[];
  open: ReceiptOpenFlag[];
  comments: ReceiptComment[];
  reclassifiedCount: number;
}

/** Mechanical scope the tool does NOT verify — a builder constant, not faked data. */
export const RECEIPT_NOT_CHECKED: readonly string[] = [
  "business intent",
  "runtime behavior",
  "performance under load",
  "integration with downstream systems",
];

export function buildReceipt(
  snapshot: SessionSnapshot,
  brief: Brief,
  model: BriefViewModel,
): Receipt {
  const flagIds = model.flags.map((flag) => flag.id);
  const counts = riskDispositionCounts(snapshot.dispositions, flagIds);

  const addressed: ReceiptAddressedFlag[] = [];
  const dismissed: ReceiptDismissedFlag[] = [];
  const open: ReceiptOpenFlag[] = [];
  for (const flag of model.flags) {
    const disposition = snapshot.dispositions[flag.id] ?? { kind: "open" };
    if (disposition.kind === "addressed") {
      addressed.push(
        disposition.evidence
          ? {
              attr: flag.attr,
              file: flag.file,
              evidence: disposition.evidence,
              evidenceLabel: riskEvidenceLabel(
                disposition.evidence,
                snapshot.reviewComments,
                brief.chunks,
              ),
            }
          : { attr: flag.attr, file: flag.file },
      );
    } else if (disposition.kind === "dismissed") {
      dismissed.push({
        attr: flag.attr,
        file: flag.file,
        reason: disposition.reason,
      });
    } else {
      open.push({ attr: flag.attr, file: flag.file });
    }
  }

  const comments: ReceiptComment[] = snapshot.reviewComments.map((comment) => ({
    id: comment.id,
    file: comment.anchor.file,
    side: comment.anchor.side,
    startLine: comment.anchor.startLine,
    endLine: comment.anchor.endLine,
    firstLine: comment.body.split("\n")[0] ?? "",
  }));

  return {
    subject: {
      repo: brief.pr.repo,
      number: brief.pr.number,
      sha: brief.pr.sha,
    },
    progress: {
      reviewedChunks: snapshot.reviewedChunkIds.length,
      chunkTotal: model.groups.reduce(
        (total, group) => total + group.chunks.length,
        0,
      ),
      flagTotal: model.flags.length,
    },
    counts,
    addressed,
    dismissed,
    open,
    comments,
    reclassifiedCount: snapshot.reclassifiedGroupIds.length,
  };
}
