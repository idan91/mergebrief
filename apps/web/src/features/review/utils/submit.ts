// Pure mapping from the session's review state to the submit route's wire
// contract. The FE owns the anchor→GitHub translation (the server validates
// shape only): side old→LEFT / new→RIGHT, multi-line ranges as
// start_line..line, commitId = the Brief's viewed head.
import type { TFunction } from "i18next";

import type { CommentAnchor, ReviewComment } from "./comments";
import type { Receipt } from "./receipt";
import type { ReviewOutcome } from "./state";

/** GitHub's diff-side wire values. */
export type WireSide = "LEFT" | "RIGHT";

export interface WireComment {
  path: string;
  /** The anchor line — the END line of a multi-line range. */
  line: number;
  side: WireSide;
  /** First line of a multi-line range; absent for single-line. */
  startLine?: number;
  startSide?: WireSide;
  /** The anchored source text — quoted by the server's degradation fold. */
  selectedText: string;
  body?: string;
}

/**
 * The submit route's body. It carries NO comments: the session already holds
 * every draft, so sending them back would make two copies and a which-wins
 * rule. The commit comes off the Brief the request names.
 */
export interface SubmitPayload {
  outcome: ReviewOutcome;
  body?: string;
}

export interface BuildSubmitPayloadInput {
  outcome: ReviewOutcome;
  /** The review body — the receipt's one-line signature on the DB path. */
  body?: string;
}

const SIDE_TO_WIRE: Record<CommentAnchor["side"], WireSide> = {
  old: "LEFT",
  new: "RIGHT",
};

/**
 * Mirrors of the submit route's caps — keep in lockstep. Anything the route
 * would 400 deterministically must block client-side with recoverable copy:
 * the UI resubmits the same draft set, so a route 400 is unrecoverable there.
 */
const MAX_SELECTED_TEXT_LENGTH = 4_000;
const MAX_COMMENTS_PER_SUBMIT = 100;
const MAX_PATH_LENGTH = 1_024;
/**
 * The route's fold budget (65536) minus a safety margin covering the
 * signature-line body, the fold preamble/separators, and estimate drift.
 */
const FOLD_BUDGET = 63_000;

/** Map one anchor to GitHub's path/line/side (+ start for multi-line). */
export function mapAnchorToWire(anchor: CommentAnchor): WireComment {
  const side = SIDE_TO_WIRE[anchor.side];
  const crossing =
    anchor.startSide !== undefined && anchor.startSide !== anchor.side;
  // A crossing range is multi-line even when the two sides' numbers agree.
  const multiLine = crossing || anchor.startLine !== anchor.endLine;
  const wire: WireComment = {
    path: anchor.file,
    line: anchor.endLine,
    side,
    selectedText: anchor.selectedText.slice(0, MAX_SELECTED_TEXT_LENGTH),
  };
  if (multiLine) {
    wire.startLine = anchor.startLine;
    wire.startSide = crossing
      ? SIDE_TO_WIRE[anchor.startSide ?? anchor.side]
      : side;
  }
  return wire;
}

/**
 * The submit route's body. The drafts are NOT in it: the session holds them
 * already, so a re-submit ships exactly the rows GitHub never saw.
 */
export function buildSubmitPayload(
  input: BuildSubmitPayloadInput,
): SubmitPayload {
  return {
    outcome: input.outcome,
    ...(input.body === undefined ? {} : { body: input.body }),
  };
}

/**
 * The submit transport's outcome, as the review flow renders it. Implemented
 * by `features/pulls/submitReview`; typed here so the review feature owns its
 * vocabulary.
 */
export type SubmitReviewResult =
  | { kind: "submitted"; reviewId: number; commentsDegraded: boolean }
  /** 409 — the PR was rewritten since it was read; reload to re-anchor. */
  | { kind: "rewritten" }
  | { kind: "unauthorized" }
  | { kind: "not-found" }
  /** 409 — a held draft's anchor no longer points at code; re-place or drop it. */
  | { kind: "orphaned-draft" }
  /** 400 (shape; programmer error) or deterministic 413 — edit the body, retry-as-is never clears. */
  | { kind: "invalid" }
  /** 502/anything else — GitHub rejected or is unreachable. */
  /**
   * 403 — a url-box brief for a repo the reader's own GitHub account cannot
   * write to. Never a retry: it clears by installing the App there.
   */
  | { kind: "no-write-access" }
  | { kind: "upstream" };

/** What the review screen hands the transport. The drafts are already saved. */
export interface SubmitDraftInput {
  outcome: ReviewOutcome;
  body: string;
}

/** The DB route's submit action, injected into the review screen. */
export type SubmitReviewAction = (
  draft: SubmitDraftInput,
) => Promise<SubmitReviewResult>;

/**
 * The one-line signature carried as the GitHub review body. Mechanical claims
 * only; never empty — GitHub requires a body for REQUEST_CHANGES, and this
 * line satisfies it for every outcome.
 */
export function buildSignatureLine(
  receipt: Receipt,
  draftCommentCount: number,
): string {
  const { progress, counts } = receipt;
  const claims = [
    `${progress.reviewedChunks}/${progress.chunkTotal} chunks read`,
    `${counts.addressed} risks addressed`,
    `${counts.dismissed} dismissed`,
    `${counts.open} open`,
    `${draftCommentCount} inline comments`,
  ];
  return `Reviewed with MergeBrief — ${claims.join(" · ")}`;
}

/**
 * Separator between the reviewer's own comment and the signature line —
 * GitHub renders `---` as a horizontal rule, fencing the tool's mechanical
 * claims off from the reviewer's words.
 */
const REVIEW_BODY_SEPARATOR = "\n\n---\n\n";

/**
 * The GitHub review body: the reviewer's free-text comment above the
 * signature line, separator-fenced; the signature alone when the comment is
 * empty (GitHub requires a nonempty body for REQUEST_CHANGES — the signature
 * satisfies it for every outcome).
 */
export function buildReviewBody(
  reviewComment: string,
  signatureLine: string,
): string {
  const trimmed = reviewComment.trim();
  return trimmed === ""
    ? signatureLine
    : `${trimmed}${REVIEW_BODY_SEPARATOR}${signatureLine}`;
}

/** What the review comment adds to the route's fold budget. */
function reviewCommentFoldCost(reviewComment: string): number {
  const trimmed = reviewComment.trim();
  return trimmed === "" ? 0 : trimmed.length + REVIEW_BODY_SEPARATOR.length;
}

/**
 * Conservative upper bound on the route's degradation fold: per comment, the
 * `file:range` marker plus the "> "-quoted selection plus the body and
 * separators. Slightly over-counts (never under) so a passing estimate can
 * never 400 at the route's exact-fold refine.
 */
function foldedLengthEstimate(drafts: readonly ReviewComment[]): number {
  return drafts.reduce((total, comment) => {
    const wire = mapAnchorToWire(comment.anchor);
    const quoted =
      wire.selectedText === undefined
        ? 0
        : wire.selectedText.length +
          2 * (wire.selectedText.split("\n").length + 1);
    // 48 covers the marker's decorations plus a two-side range with both
    // sides spelled out (`LEFT n-RIGHT n`), which outgrows the bare numbers.
    const commentCost =
      wire.path.length + 48 + quoted + comment.body.length + 8;
    return total + commentCost;
  }, 0);
}

/**
 * Why Submit is disabled, or `undefined` when it may proceed. A neutral
 * COMMENT review needs content — an inline draft or the review comment
 * (GitHub 422s an empty one); approve /
 * request-changes carry their verdict as the content. Anything the route
 * would 400 deterministically (comment cap, fold budget) blocks HERE with a
 * recoverable reason — the UI resubmits the same draft set on retry.
 */
export function submitBlockedReason(
  t: TFunction,
  outcome: ReviewOutcome,
  comments: ReviewComment[],
  reviewComment = "",
): string | undefined {
  const drafts = comments.filter((comment) => comment.status === "draft");
  if (drafts.length > MAX_COMMENTS_PER_SUBMIT) {
    return t("review.submit.tooManyComments", {
      max: MAX_COMMENTS_PER_SUBMIT,
      excess: drafts.length - MAX_COMMENTS_PER_SUBMIT,
    });
  }
  const commentCost = reviewCommentFoldCost(reviewComment);
  if (foldedLengthEstimate(drafts) + commentCost > FOLD_BUDGET) {
    return commentCost > 0
      ? t("review.submit.tooLargeWithReviewComment")
      : t("review.submit.tooLargeComments");
  }
  const overlongPath = drafts.find(
    (draft) => draft.anchor.file.length > MAX_PATH_LENGTH,
  );
  if (overlongPath !== undefined) {
    return t("review.submit.pathTooLong");
  }
  if (outcome !== "comment") {
    return undefined;
  }
  if (drafts.length === 0 && reviewComment.trim() === "") {
    return t("review.submit.commentNeedsContent");
  }
  return undefined;
}
