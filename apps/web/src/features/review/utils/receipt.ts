import type { TranslationKey } from "i18n";
import type { TFunction } from "i18next";
import {
  OutlineForms,
  ShortenedReadings,
  type OutlineForm,
  type ShortenedReading,
} from "brief-core/types";
import type {
  Brief,
  BriefViewModel,
  RepoConfigContext,
} from "@web/features/brief/model";
import {
  CommentAnchorKinds,
  type DiffSide,
  DiffSides,
  DraftCommentStatuses,
  type DraftCommentStatus,
} from "types";
import { UnknownValues } from "@web/utils/open-enum/types";
import { isFileCommentAnchor, type ReviewComment } from "./comments";
import type { SessionSnapshot } from "../session";
import { DispositionKinds, type DispositionKind } from "../session/types";
import {
  riskDispositionCounts,
  riskEvidenceLabel,
  type HeldRiskEvidence,
  type RiskDispositionCounts,
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
  evidence?: HeldRiskEvidence;
  /**
   * @description Shared human label for the evidence.
   * Consumers supply their own empty fallback.
   */
  evidenceLabel?: string;
  /** The same label as it reads mid-line in the receipt text. */
  evidenceLabelInline?: string;
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
  status: DraftCommentStatus;
}

export interface ReceiptLineComment extends ReceiptCommentBase {
  kind: typeof CommentAnchorKinds.LINE;
  side: DiffSide;
  /** Present only when the range genuinely crosses sides. */
  startSide?: DiffSide;
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

/** One file a multi-call run showed the model by its facts, not its code. */
export interface ReceiptShortenedFile {
  file: string;
  readAs: ShortenedReading;
}

/** What a multi-call run's grouping call read; absent on a single-call Brief. */
export interface ReceiptGeneration {
  outlineForm: OutlineForm;
  shortened: ReceiptShortenedFile[];
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
  /** Present on a multi-call Brief. */
  generation?: ReceiptGeneration;
}

/** What the grouping saw in place of code, on the outline forms that show none. */
export const NO_CODE_OUTLINE_NOTE_KEYS: Record<
  OutlineForm,
  TranslationKey | undefined
> = {
  [OutlineForms.FULL]: undefined,
  [OutlineForms.LINES_40]: undefined,
  [OutlineForms.LINES_20]: undefined,
  [OutlineForms.LINES_12]: undefined,
  [OutlineForms.LINES_6]: undefined,
  [OutlineForms.LINES_2]: undefined,
  [OutlineForms.HEADERS]: "review.summary.outlineNoCode",
  [OutlineForms.FILES]: "review.summary.outlineNoCodeFiles",
};

/** The frozen receipt's form of the same note. */
const NO_CODE_OUTLINE_LINES: Record<OutlineForm, string | undefined> = {
  [OutlineForms.FULL]: undefined,
  [OutlineForms.LINES_40]: undefined,
  [OutlineForms.LINES_20]: undefined,
  [OutlineForms.LINES_12]: undefined,
  [OutlineForms.LINES_6]: undefined,
  [OutlineForms.LINES_2]: undefined,
  [OutlineForms.HEADERS]:
    "      the grouping saw no code lines: groups come from paths, headers and counts",
  [OutlineForms.FILES]:
    "      the grouping saw no code lines or hunk headers: groups come from paths and counts",
};

export const OUTLINE_FORM_KEYS: Record<OutlineForm, TranslationKey> = {
  [OutlineForms.FULL]: "review.summary.outlineFormFull",
  [OutlineForms.LINES_40]: "review.summary.outlineFormLines40",
  [OutlineForms.LINES_20]: "review.summary.outlineFormLines20",
  [OutlineForms.LINES_12]: "review.summary.outlineFormLines12",
  [OutlineForms.LINES_6]: "review.summary.outlineFormLines6",
  [OutlineForms.LINES_2]: "review.summary.outlineFormLines2",
  [OutlineForms.HEADERS]: "review.summary.outlineFormHeaders",
  [OutlineForms.FILES]: "review.summary.outlineFormFiles",
};

function buildReceiptGeneration(brief: Brief): ReceiptGeneration | undefined {
  if (brief.outlineForm === undefined) {
    return undefined;
  }

  const shortened: ReceiptShortenedFile[] = [];
  for (const chunk of brief.chunks) {
    if (chunk.readAs !== undefined) {
      shortened.push({ file: chunk.file, readAs: chunk.readAs });
    }
  }

  return {
    outlineForm: brief.outlineForm,
    shortened,
  };
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

/** A status this bundle predates has no truthful line on the receipt. */
function hasKnownStatus(
  comment: ReviewComment,
): comment is ReviewComment & { status: DraftCommentStatus } {
  return comment.status !== UnknownValues.UNKNOWN;
}

export function buildReceipt(
  t: TFunction,
  snapshot: SessionSnapshot,
  brief: Brief,
  model: BriefViewModel,
  repoConfig?: RepoConfigContext | null,
): Receipt {
  const chunks = model.groups.flatMap((group) => group.chunks);
  const flagIds = model.flags.map((flag) => flag.id);
  const counts = riskDispositionCounts(snapshot.dispositions, flagIds);

  const addressed: ReceiptAddressedFlag[] = [];
  const dismissed: ReceiptDismissedFlag[] = [];
  const open: ReceiptOpenFlag[] = [];
  for (const flag of model.flags) {
    const disposition = snapshot.dispositions[flag.id] ?? {
      kind: DispositionKinds.OPEN,
    };
    if (disposition.kind === DispositionKinds.ADDRESSED) {
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
                chunks,
              ),
              evidenceLabelInline: riskEvidenceLabel(
                t,
                disposition.evidence,
                snapshot.reviewComments,
                chunks,
                "inline",
              ),
            }
          : { id: flag.id, attr: flag.attr, file: flag.file },
      );
    } else if (disposition.kind === DispositionKinds.DISMISSED) {
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

  const known = snapshot.reviewComments.filter(hasKnownStatus);
  const comments: ReceiptComment[] = known.map((comment) => {
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
      chunkTotal: chunks.length,
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
  const generation = buildReceiptGeneration(brief);
  if (generation !== undefined) {
    receipt.generation = generation;
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
  const sign = comment.side === DiffSides.NEW ? "+" : "-";
  if (comment.startSide !== undefined && comment.startSide !== comment.side) {
    const startSign = comment.startSide === DiffSides.NEW ? "+" : "-";
    const crossSideLabel = `${comment.file}:${startSign}${comment.startLine}→${sign}${comment.endLine}`;
    return crossSideLabel;
  }
  const range =
    comment.startLine === comment.endLine
      ? `${sign}${comment.startLine}`
      : `${sign}${comment.startLine}-${comment.endLine}`;
  const label = `${comment.file}:${range}`;
  return label;
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
  key: DispositionKind;
  title: string;
  items: ReceiptRiskRow[];
  /** Each row's detail is text the reviewer wrote, so its mentions are marked. */
  reviewerWroteDetail: boolean;
}

/** The disposition lists as uniform display rows, shared by every receipt
 * rendering so per-flag detail fallbacks cannot diverge between surfaces. */
export function receiptRiskGroups(
  t: TFunction,
  receipt: Receipt,
): ReceiptRiskGroup[] {
  return [
    {
      key: DispositionKinds.ADDRESSED,
      title: t("review.summary.addressedRisks"),
      reviewerWroteDetail: false,
      items: receipt.addressed.map((flag) => ({
        id: flag.id,
        attr: flag.attr,
        file: flag.file,
        detail: flag.evidenceLabel ?? t("review.summary.noEvidenceLinked"),
      })),
    },
    {
      key: DispositionKinds.DISMISSED,
      title: t("review.summary.dismissedRisks"),
      reviewerWroteDetail: true,
      items: receipt.dismissed.map((flag) => ({
        id: flag.id,
        attr: flag.attr,
        file: flag.file,
        detail: flag.reason,
      })),
    },
    {
      key: DispositionKinds.OPEN,
      title: t("review.summary.openRisks"),
      reviewerWroteDetail: false,
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

/** Frozen receipt format, English by shape: the submit flow shows it, nothing posts it. */
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
    return `      ${label}: ${comment.file}: ${comment.firstLine}`;
  }
  const range =
    comment.endLine === comment.startLine ? "" : `-${comment.endLine}`;
  return `      ${label}: ${comment.file}:${comment.startLine}${range}: ${comment.firstLine}`;
}

function renderProgressLines(receipt: Receipt): string[] {
  const { progress, addressed, dismissed, comments } = receipt;
  const chunksDone = progress.reviewedChunks >= progress.chunkTotal;
  const surfaceDone = addressed.length + dismissed.length >= progress.flagTotal;
  const posted = comments.filter(
    (comment) => comment.status === DraftCommentStatuses.SUBMITTED,
  );
  const postedPart = posted.length > 0 ? ` · ${posted.length} posted` : "";
  const drafts = comments.filter(
    (comment) => comment.status === DraftCommentStatuses.DRAFT,
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
    return `      ${file.path}: ${file.outcome}${sha}`;
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

/** The frozen-format words for each read-as mark. */
const READ_AS_LINE_LABELS: Record<ShortenedReading, string> = {
  [ShortenedReadings.PACKAGE_SUMMARY]: "read as package changes",
  [ShortenedReadings.COUNTS_ONLY]: "read as counts only",
};

/**
 * One receipt line: text, or a file the generation record names by its
 * repo-relative path, which a view may shorten from the left.
 */
export type ReceiptLine = string | ReceiptFileLine;

export interface ReceiptFileLine {
  file: string;
}

/** A named file sits one level under the line that names its reading. */
export const RECEIPT_FILE_INDENT = "        ";

function listGenerationLines(
  generation: ReceiptGeneration | undefined,
): ReceiptLine[] {
  if (generation === undefined) {
    return [];
  }

  const lines: ReceiptLine[] = [
    "",
    "  generation (multi-call):",
    `      outline read by the grouping: ${generation.outlineForm}`,
  ];
  const noCodeLine = NO_CODE_OUTLINE_LINES[generation.outlineForm];
  if (noCodeLine !== undefined) {
    lines.push(noCodeLine);
  }
  for (const readAs of Object.values(ShortenedReadings)) {
    const files = generation.shortened.filter(
      (entry) => entry.readAs === readAs,
    );
    if (files.length > 0) {
      lines.push(`      ${READ_AS_LINE_LABELS[readAs]}:`);
      lines.push(...files.map((entry) => ({ file: entry.file })));
    }
  }
  return lines;
}

/**
 * The frozen receipt as lines: mechanical claims plus a visible "not
 * checked" line. A run of two or more blank lines, left by empty sections,
 * drops out; a single blank line stays.
 */
export function listReceiptLines(receipt: Receipt): ReceiptLine[] {
  const { subject, comments, addressed, dismissed } = receipt;
  // Drafts ship on the next submit; submitted ones were already posted and
  // are listed as the record they are.
  const drafts = comments.filter(
    (comment) => comment.status === DraftCommentStatuses.DRAFT,
  );
  const posted = comments.filter(
    (comment) => comment.status === DraftCommentStatuses.SUBMITTED,
  );

  // An empty section contributes an empty string; the blank runs those
  // leave behind collapse below.
  const sections = [
    `Reviewed by @you (human) · ${subject.repo} #${subject.number} @ ${subject.sha.slice(0, 7)}`,
    "Tool verification receipt: mechanical claims only",
    "",
    ...renderProgressLines(receipt),
    drafts.map((comment) => renderCommentLine("comment", comment)).join("\n"),
    posted.map((comment) => renderCommentLine("posted", comment)).join("\n"),
    addressed
      .map(
        (flag) =>
          `      addressed: ${flag.attr} @ ${shortFile(flag.file)}: ${flag.evidenceLabelInline ?? "addressed without linked evidence"}`,
      )
      .join("\n"),
    dismissed
      .map(
        (flag) =>
          `      dismissed: ${flag.attr} @ ${shortFile(flag.file)}: "${flag.reason}"`,
      )
      .join("\n"),
    receipt.open
      .map(
        (flag) =>
          `      open: ${flag.attr} @ ${shortFile(flag.file)}: not addressed, not dismissed`,
      )
      .join("\n"),
    renderReclassifiedBlock(receipt.reclassifiedCount),
    renderRepoConfigBlock(receipt.repoConfig),
  ];
  const lines: ReceiptLine[] = [
    ...sections.flatMap((section) => section.split("\n")),
    ...listGenerationLines(receipt.generation),
    `  not checked: ${RECEIPT_NOT_CHECKED.join(" · ")}`,
  ];

  return dropBlankRuns(lines);
}

/** A blank line stays only where no other blank line touches it. */
function dropBlankRuns(lines: readonly ReceiptLine[]): ReceiptLine[] {
  return lines.filter((line, index) => {
    if (line !== "") {
      return true;
    }
    return lines[index - 1] !== "" && lines[index + 1] !== "";
  });
}
