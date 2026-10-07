import type { TranslationKey } from "i18n";
import type { TFunction } from "i18next";
import type {
  BriefViewModel,
  RepoConfigContext,
} from "@web/features/brief/utils";
import type { Brief } from "../../brief/types";
import { CommentAnchorKinds } from "types/comments";
import {
  isFileCommentAnchor,
  ReviewCommentStatuses,
  type CommentSide,
  type ReviewCommentStatus,
} from "./comments";
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

export interface ReceiptCommentBase {
  id: string;
  file: string;
  firstLine: string;
  /**
   * @description `draft` ships on the NEXT submit; `submitted` was already
   * posted to GitHub by an earlier one.
   */
  status: ReviewCommentStatus;
}

export interface ReceiptLineComment extends ReceiptCommentBase {
  kind: typeof CommentAnchorKinds.LINE;
  side: CommentSide;
  /** Present only when the range genuinely crosses sides. */
  startSide?: CommentSide;
  startLine: number;
  endLine: number;
}

export interface ReceiptFileComment extends ReceiptCommentBase {
  kind: typeof CommentAnchorKinds.FILE;
}

export type ReceiptComment = ReceiptLineComment | ReceiptFileComment;

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
    if (isFileCommentAnchor(comment.anchor)) {
      return {
        id: comment.id,
        kind: CommentAnchorKinds.FILE,
        file: comment.anchor.file,
        firstLine: comment.body.split("\n")[0] ?? "",
        status: comment.status,
      };
    }
    const receiptComment: ReceiptLineComment = {
      id: comment.id,
      kind: CommentAnchorKinds.LINE,
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

  if (receiptRepoConfig !== undefined) {
    receipt.repoConfig = receiptRepoConfig;
  }

  return receipt;
}

/**
 * `file:+start[-end]`, the on-screen anchor for a receipt comment
 * (ReceiptAccordion). NOT the frozen artifact's shape, which
 * prints no side sign.
 */
export function receiptCommentLabel(comment: ReceiptComment): string {
  if (comment.kind === CommentAnchorKinds.FILE) {
    return comment.file;
  }
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
  if (repoConfig === null || repoConfig === undefined) {
    return undefined;
  }
  const anyPresent =
    repoConfig.files.some((file) => file.outcome !== "absent") ||
    repoConfig.collisions.length > 0;
  if (!anyPresent) {
    return undefined;
  }
  const policySha =
    repoConfig.files.find((file) => file.path.endsWith("policy.yaml"))
      ?.blobSha ?? null;
  // Attributes, not rules: one attribute may carry several path-scoped rules.
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
    deEmphasisLine: renderDeEmphasisLine(deEmphasized, policySha),
  };
}

/** Frozen receipt format written into GitHub, English by shape. */
function renderDeEmphasisLine(
  attributes: number,
  policySha: string | null,
): string | null {
  if (attributes === 0) {
    return null;
  }

  const noun = attributes === 1 ? "attribute" : "attributes";
  const at = policySha === null ? "" : ` @ ${policySha.slice(0, 7)}`;

  return `${attributes} ${noun} de-emphasized by repo policy${at}`;
}

/** The last path segment, which is how the receipt names a file. */
export function shortFile(path: string): string {
  const parts = path.split("/");
  return parts.at(-1) ?? path;
}

function renderCommentLine(label: string, comment: ReceiptComment): string {
  if (comment.kind === CommentAnchorKinds.FILE) {
    return `      ${label}: ${comment.file} — ${comment.firstLine}`;
  }
  const range =
    comment.endLine === comment.startLine ? "" : `-${comment.endLine}`;
  return `      ${label}: ${comment.file}:${comment.startLine}${range} — ${comment.firstLine}`;
}

function renderProgressLines(receipt: Receipt): string[] {
  const { progress, addressed, dismissed, comments } = receipt;
  const chunksDone = progress.reviewedChunks >= progress.chunkTotal;
  const surfaceDone = addressed.length + dismissed.length >= progress.flagTotal;
  const posted = comments.filter(
    (comment) => comment.status === ReviewCommentStatuses.SUBMITTED,
  );
  const postedPart = posted.length > 0 ? ` · ${posted.length} posted` : "";
  const drafts = comments.filter(
    (comment) => comment.status === ReviewCommentStatuses.DRAFT,
  );

  return [
    `  ${chunksDone ? "✓" : "•"} chunks read: ${progress.reviewedChunks}/${progress.chunkTotal}`,
    `  ${surfaceDone ? "✓" : "•"} risk surface: ${addressed.length} addressed · ${dismissed.length} dismissed · ${receipt.open.length} open`,
    `  ${comments.length > 0 ? "✓" : "•"} inline comments: ${drafts.length} draft${postedPart}`,
  ];
}

function renderReclassifiedBlock(count: number): string {
  if (count === 0) {
    return "";
  }
  return `\n  ${count} group reclassified by reviewer`;
}

function renderRepoConfigBlock(
  repoConfig: ReceiptRepoConfig | undefined,
): string {
  if (repoConfig === undefined) {
    return "";
  }

  const fileLines = repoConfig.files.map((file) => {
    const sha =
      file.blobSha === null || file.blobSha === ""
        ? ""
        : ` @ ${file.blobSha.slice(0, 7)}`;
    return `      ${file.path} — ${file.outcome}${sha}`;
  });
  // The empty join is deliberate: a config with no files keeps the blank line
  // the frozen format has always emitted there.
  const lines = ["", "  repo config (generation-time):", fileLines.join("\n")];
  if (repoConfig.collisions.length > 0) {
    lines.push(`      built-in wins over: ${repoConfig.collisions.join(", ")}`);
  }
  if (repoConfig.deEmphasisLine !== null && repoConfig.deEmphasisLine !== "") {
    lines.push(`      ${repoConfig.deEmphasisLine}`);
  }

  return lines.join("\n");
}

function rawReceiptText(receipt: Receipt): string {
  const { subject, comments, addressed, dismissed } = receipt;
  // Drafts ship on the next submit; submitted ones were already posted and
  // are listed as the record they are.
  const drafts = comments.filter(
    (comment) => comment.status === ReviewCommentStatuses.DRAFT,
  );
  const posted = comments.filter(
    (comment) => comment.status === ReviewCommentStatuses.SUBMITTED,
  );

  // One array entry per receipt line. An empty section contributes an empty
  // string, and receiptText collapses the blank runs those leave behind.
  const lines = [
    `Reviewed by @you (human) · ${subject.repo} #${subject.number} @ ${subject.sha.slice(0, 7)}`,
    "Tool verification receipt — mechanical claims only",
    "",
    ...renderProgressLines(receipt),
    drafts.map((comment) => renderCommentLine("comment", comment)).join("\n"),
    posted.map((comment) => renderCommentLine("posted", comment)).join("\n"),
    addressed
      .map(
        (flag) =>
          `      addressed: ${flag.attr} @ ${shortFile(flag.file)} — ${flag.evidenceLabel ?? "addressed without linked evidence"}`,
      )
      .join("\n"),
    dismissed
      .map(
        (flag) =>
          `      dismissed: ${flag.attr} @ ${shortFile(flag.file)} — "${flag.reason}"`,
      )
      .join("\n"),
    receipt.open
      .map(
        (flag) =>
          `      open: ${flag.attr} @ ${shortFile(flag.file)} — not addressed, not dismissed`,
      )
      .join("\n"),
    renderReclassifiedBlock(receipt.reclassifiedCount),
    renderRepoConfigBlock(receipt.repoConfig),
    `  not checked: ${RECEIPT_NOT_CHECKED.join(" · ")}`,
  ];

  return lines.join("\n");
}

/** The frozen receipt rendering: mechanical claims plus a visible "not
 * checked" line; blank-line runs left by empty sections collapse. */
export function receiptText(receipt: Receipt): string {
  return rawReceiptText(receipt).replace(/\n{3,}/g, "\n");
}
