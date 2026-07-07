// Submit assembly (BRIEF-23 PR 3): pure mapping from the session's review
// state to the submit route's wire contract. The FE owns the anchor→GitHub
// translation (the server validates shape only): side old→LEFT / new→RIGHT,
// multi-line ranges as start_line..line, commitId = the Brief's viewed head.
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

export interface SubmitPayload {
  outcome: ReviewOutcome;
  commitId: string;
  body?: string;
  comments: (WireComment & { body: string })[];
}

export interface BuildSubmitPayloadInput {
  outcome: ReviewOutcome;
  /** The viewed head — the SHA the anchors were read against. */
  commitId: string;
  /** The review body — the receipt's one-line signature on the DB path. */
  body?: string;
  comments: ReviewComment[];
}

const SIDE_TO_WIRE: Record<CommentAnchor["side"], WireSide> = {
  old: "LEFT",
  new: "RIGHT",
};

/**
 * Route-cap mirrors (packages/api review-submit schema): selectedText is
 * quote metadata capped at 4000 chars, a review carries at most 100
 * comments, and the route pre-validates that the DEGRADATION FOLD of the
 * whole payload fits GitHub's 65536-char body cap. Anything the route would
 * 400 deterministically must block client-side with recoverable copy — the
 * UI resubmits the same draft set, so a route 400 is unrecoverable there.
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
  const multiLine = anchor.startLine !== anchor.endLine;
  return {
    path: anchor.file,
    line: anchor.endLine,
    side,
    ...(multiLine ? { startLine: anchor.startLine, startSide: side } : {}),
    selectedText: anchor.selectedText.slice(0, MAX_SELECTED_TEXT_LENGTH),
  };
}

/**
 * The submit route's body. Only DRAFT comments ship — a re-submit adds the
 * new drafts as a new review (documented-allowed) and never re-posts what an
 * earlier submit already delivered.
 */
export function buildSubmitPayload(
  input: BuildSubmitPayloadInput,
): SubmitPayload {
  return {
    outcome: input.outcome,
    commitId: input.commitId,
    ...(input.body === undefined ? {} : { body: input.body }),
    comments: input.comments
      .filter((comment) => comment.status === "draft")
      .map((comment) => ({
        ...mapAnchorToWire(comment.anchor),
        body: comment.body,
      })),
  };
}

/**
 * The submit transport's outcome, as the review flow renders it. Implemented
 * by `features/pulls/submitReview` (the DB route); typed here so the review
 * feature owns its vocabulary and the heavy component depends only on this
 * module.
 */
export type SubmitReviewResult =
  | { kind: "submitted"; reviewId: number; commentsDegraded: boolean }
  /** 409 — the PR was rewritten since it was read; reload to re-anchor. */
  | { kind: "rewritten" }
  | { kind: "unauthorized" }
  | { kind: "not-found" }
  /** 400 — the route rejected the shape (programmer error on our side). */
  | { kind: "invalid" }
  /** 502/anything else — GitHub rejected or is unreachable. */
  | { kind: "upstream" };

/** What the review screen hands the transport; commitId is the caller's. */
export interface SubmitDraftInput {
  outcome: ReviewOutcome;
  body: string;
  comments: ReviewComment[];
}

/** The DB route's submit action, injected into the review screen. */
export type SubmitReviewAction = (
  draft: SubmitDraftInput,
) => Promise<SubmitReviewResult>;

/**
 * The one-line signature carried as the GitHub review body (ADR 0002: the
 * receipt is "linked from a one-line signature on your normal GitHub
 * review"). Mechanical claims only; never empty — GitHub requires a body for
 * REQUEST_CHANGES, and this line satisfies it for every outcome.
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
  return `Reviewed with Brief — ${claims.join(" · ")}`;
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
    return total + wire.path.length + 32 + quoted + comment.body.length + 8;
  }, 0);
}

/**
 * Why Submit is disabled, or `undefined` when it may proceed. A neutral
 * COMMENT review needs content (GitHub 422s an empty one); approve /
 * request-changes carry their verdict as the content. Anything the route
 * would 400 deterministically (comment cap, fold budget) blocks HERE with a
 * recoverable reason — the UI resubmits the same draft set on retry.
 */
export function submitBlockedReason(
  outcome: ReviewOutcome,
  comments: ReviewComment[],
): string | undefined {
  const drafts = comments.filter((comment) => comment.status === "draft");
  if (drafts.length > MAX_COMMENTS_PER_SUBMIT) {
    return `A review can carry at most ${MAX_COMMENTS_PER_SUBMIT} comments. Trim ${drafts.length - MAX_COMMENTS_PER_SUBMIT} draft(s), or submit in parts by deleting some drafts and re-adding them after this review posts.`;
  }
  if (foldedLengthEstimate(drafts) > FOLD_BUDGET) {
    return "This review's comments are too large to submit as one review (GitHub's body limit). Shorten some comments, or submit in parts.";
  }
  const overlongPath = drafts.find(
    (draft) => draft.anchor.file.length > MAX_PATH_LENGTH,
  );
  if (overlongPath !== undefined) {
    return "A comment is anchored to a file whose path is too long to submit. Delete that draft to continue.";
  }
  if (outcome !== "comment") {
    return undefined;
  }
  if (drafts.length === 0) {
    return "A comment-only review needs at least one comment. Add one, or pick a verdict.";
  }
  return undefined;
}
