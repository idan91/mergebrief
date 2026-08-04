import type { RepoConfigContext } from "../../brief/utils/repoConfig";
import type { Brief } from "../../brief/types";
import type { BriefViewModel } from "@web/features/brief/utils";
import type { CommentSide } from "./comments";
import type { SessionSnapshot } from "../session";
import {
  riskDispositionCounts,
  riskEvidenceLabel,
  type RiskDispositionCounts,
  type RiskEvidence,
} from "./state";

/**
 * The Receipt (ADR 0002) as a structured value, not a rendered string. Built
 * from the frozen session snapshot so both the in-app SubmitModal receipt view and the
 * static Review Summary render the same content their own way. Carries the real
 * disposition data (evidence / reason) rather than pre-formatted text, so each
 * consumer keeps its own labelling and fallbacks. No invented "mechanical
 * verified" buckets — only data that actually exists (defer-don't-fake).
 */
export interface ReceiptAddressedFlag {
  /** The source RiskFlag's id — the stable per-flag key. */
  id: string;
  attr: string;
  file: string;
  /**
   * @description Resolved per-flag evidence, when present.
   * `addressed-pending-evidence` omits it.
   */
  evidence?: RiskEvidence;
  /**
   * @description Shared human label for the evidence.
   * Consumers supply their own empty fallback.
   */
  evidenceLabel?: string;
}

export interface ReceiptDismissedFlag {
  /** The source RiskFlag's id — the stable per-flag key. */
  id: string;
  attr: string;
  file: string;
  /**
   * @description The reviewer's reason, verbatim.
   */
  reason: string;
}

export interface ReceiptOpenFlag {
  /** The source RiskFlag's id — the stable per-flag key. */
  id: string;
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
  /**
   * @description `draft` ships on the NEXT submit; `submitted` was already
   * posted to GitHub by an earlier one (BRIEF-23).
   */
  status: "draft" | "submitted";
}

/** The permanent repo-config record on the Receipt (ADR 0032 #8). */
export interface ReceiptRepoConfig {
  files: { path: string; outcome: string; blobSha: string | null }[];
  collisions: string[];
  /** "N attribute(s) de-emphasized by repo policy @ sha" — null when none. */
  deEmphasisLine: string | null;
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
  /** Present when the span had a repo-config surface (BRIEF-52). */
  repoConfig?: ReceiptRepoConfig;
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
  repoConfig?: RepoConfigContext | null,
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
              id: flag.id,
              attr: flag.attr,
              file: flag.file,
              evidence: disposition.evidence,
              evidenceLabel: riskEvidenceLabel(
                disposition.evidence,
                snapshot.reviewComments,
                brief.chunks,
              ),
            }
          : { id: flag.id, attr: flag.attr, file: flag.file },
      );
    } else if (disposition.kind === "dismissed") {
      dismissed.push({
        id: flag.id,
        attr: flag.attr,
        file: flag.file,
        reason: disposition.reason,
      });
    } else {
      open.push({ id: flag.id, attr: flag.attr, file: flag.file });
    }
  }

  const comments: ReceiptComment[] = snapshot.reviewComments.map((comment) => ({
    id: comment.id,
    file: comment.anchor.file,
    side: comment.anchor.side,
    startLine: comment.anchor.startLine,
    endLine: comment.anchor.endLine,
    firstLine: comment.body.split("\n")[0] ?? "",
    status: comment.status,
  }));

  const receiptRepoConfig = buildReceiptRepoConfig(repoConfig);
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
    ...(receiptRepoConfig === undefined
      ? {}
      : { repoConfig: receiptRepoConfig }),
  };
}

/**
 * The Receipt's permanent repo-config record (ADR 0032 #8): the per-file
 * table plus the de-emphasis tuning in effect at generation time. Undefined
 * when there was no surface at all (no snapshot, or all-absent + no
 * collisions) — the Receipt stays byte-identical for repos without a
 * `.mergebrief/`.
 */
function buildReceiptRepoConfig(
  repoConfig: RepoConfigContext | null | undefined,
): ReceiptRepoConfig | undefined {
  if (repoConfig == null) return undefined;
  const anyPresent =
    repoConfig.files.some((file) => file.outcome !== "absent") ||
    repoConfig.collisions.length > 0;
  if (!anyPresent) return undefined;
  const policySha =
    repoConfig.files.find((file) => file.path.endsWith("policy.yaml"))
      ?.blobSha ?? null;
  // Count ATTRIBUTES, not rules — one attribute may carry several
  // path-scoped rules (Fable r1 on this PR).
  const deEmphasized = new Set(
    (repoConfig.policy?.deEmphasize ?? []).map((rule) => rule.attribute),
  ).size;
  return {
    files: repoConfig.files.map((file) => ({
      path: file.path,
      outcome: file.outcome,
      blobSha: file.blobSha,
    })),
    collisions: [...repoConfig.collisions],
    deEmphasisLine:
      deEmphasized > 0
        ? `${deEmphasized} attribute${deEmphasized === 1 ? "" : "s"} de-emphasized by repo policy${policySha ? ` @ ${policySha.slice(0, 7)}` : ""}`
        : null,
  };
}
