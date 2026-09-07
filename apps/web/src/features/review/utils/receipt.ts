import type { TranslationKey } from "i18n";
import type { TFunction } from "i18next";
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
 * The Receipt as a structured value, not a rendered string: both the in-app
 * receipt view and the static Review Summary render it their own way. Carries
 * real disposition data (evidence / reason) rather than pre-formatted text so
 * each consumer keeps its own labelling and fallbacks.
 */
export interface ReceiptAddressedFlag {
  /** The source RiskFlag's id, the stable per-flag key. */
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
  /** The source RiskFlag's id, the stable per-flag key. */
  id: string;
  attr: string;
  file: string;
  /**
   * @description The reviewer's reason, verbatim.
   */
  reason: string;
}

export interface ReceiptOpenFlag {
  /** The source RiskFlag's id, the stable per-flag key. */
  id: string;
  attr: string;
  file: string;
}

export interface ReceiptComment {
  id: string;
  file: string;
  side: CommentSide;
  /** Present only when the range genuinely crosses sides. */
  startSide?: CommentSide;
  startLine: number;
  endLine: number;
  firstLine: string;
  /**
   * @description `draft` ships on the NEXT submit; `submitted` was already
   * posted to GitHub by an earlier one.
   */
  status: "draft" | "submitted";
}

/** The permanent repo-config record on the Receipt. */
export interface ReceiptRepoConfig {
  files: { path: string; outcome: string; blobSha: string | null }[];
  collisions: string[];
  /** "N attribute(s) de-emphasized by repo policy @ sha", null when none. */
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
  /** Present when the span had a repo-config surface. */
  repoConfig?: ReceiptRepoConfig;
}

/**
 * Mechanical scope the tool does NOT verify, a builder constant, not faked
 * data. Two forms on purpose: the receipt `<pre>` renders a FROZEN artifact
 * format (fixed-shape lines a reader may copy or diff), so it stays English
 * and locale-independent; the prose list in the summary reads the catalog.
 */
export const RECEIPT_NOT_CHECKED: readonly string[] = [
  "business intent",
  "runtime behavior",
  "performance under load",
  "integration with downstream systems",
];

export const RECEIPT_NOT_CHECKED_KEYS: readonly TranslationKey[] = [
  "review.summary.notCheckedIntent",
  "review.summary.notCheckedRuntime",
  "review.summary.notCheckedPerformance",
  "review.summary.notCheckedIntegration",
];

export function buildReceipt(
  t: TFunction,
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
                t,
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

  const comments: ReceiptComment[] = snapshot.reviewComments.map((comment) => {
    const receiptComment: ReceiptComment = {
      id: comment.id,
      file: comment.anchor.file,
      side: comment.anchor.side,
      startLine: comment.anchor.startLine,
      endLine: comment.anchor.endLine,
      firstLine: comment.body.split("\n")[0] ?? "",
      status: comment.status,
    };

    if (comment.anchor.startSide !== undefined) {
      receiptComment.startSide = comment.anchor.startSide;
    }

    return receiptComment;
  });

  const receiptRepoConfig = buildReceiptRepoConfig(repoConfig);
  const receipt: Receipt = {
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

  if (receiptRepoConfig !== undefined) receipt.repoConfig = receiptRepoConfig;

  return receipt;
}

/**
 * `file:+start[-end]`, the on-screen anchor for a receipt comment
 * (ReceiptAccordion). NOT the frozen artifact's shape, which
 * prints no side sign.
 */
export function receiptCommentLabel(comment: ReceiptComment): string {
  const sign = comment.side === "new" ? "+" : "-";
  if (comment.startSide !== undefined && comment.startSide !== comment.side) {
    const startSign = comment.startSide === "new" ? "+" : "-";
    return `${comment.file}:${startSign}${comment.startLine}→${sign}${comment.endLine}`;
  }
  const range =
    comment.startLine === comment.endLine
      ? `${sign}${comment.startLine}`
      : `${sign}${comment.startLine}-${comment.endLine}`;
  return `${comment.file}:${range}`;
}

export interface ReceiptRiskRow {
  /** The flag's own id, (attr, file) pairs repeat when two chunks in one
   * file carry the same attribute. */
  id: string;
  attr: string;
  file: string;
  detail: string;
}

export interface ReceiptRiskGroup {
  key: "addressed" | "dismissed" | "open";
  title: string;
  items: ReceiptRiskRow[];
}

/** The disposition lists as uniform display rows, shared by every receipt
 * rendering so per-flag detail fallbacks cannot diverge between surfaces. */
export function receiptRiskGroups(
  t: TFunction,
  receipt: Receipt,
): ReceiptRiskGroup[] {
  return [
    {
      key: "addressed",
      title: t("review.summary.addressedRisks"),
      items: receipt.addressed.map((flag) => ({
        id: flag.id,
        attr: flag.attr,
        file: flag.file,
        detail: flag.evidenceLabel ?? t("review.summary.noEvidenceLinked"),
      })),
    },
    {
      key: "dismissed",
      title: t("review.summary.dismissedRisks"),
      items: receipt.dismissed.map((flag) => ({
        id: flag.id,
        attr: flag.attr,
        file: flag.file,
        detail: flag.reason,
      })),
    },
    {
      key: "open",
      title: t("review.summary.openRisks"),
      items: receipt.open.map((flag) => ({
        id: flag.id,
        attr: flag.attr,
        file: flag.file,
        detail: t("review.summary.notAddressedNotDismissed"),
      })),
    },
  ];
}

/**
 * The per-file table plus the de-emphasis tuning in effect at generation
 * time. Undefined when there was no surface at all, so the Receipt stays
 * byte-identical for repos without a `.mergebrief/`.
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
  // Count ATTRIBUTES, not rules, one attribute may carry several
  // path-scoped rules.
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
