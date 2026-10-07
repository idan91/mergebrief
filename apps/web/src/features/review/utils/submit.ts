// The submit route's request body, the review body the hook sends, and the
// client-side refusal that mirrors the route's deterministic 400s. The fold
// below rebuilds the exact string the route measures, so it must track
// `foldCommentsIntoBody` in apps/api's publish module character for character.
import type { TFunction } from "i18next";
import { CommentAnchorKinds } from "types/comments";
import { ThreadSides, type ThreadSide } from "@web/features/conversation/types";

import type {
  SessionDraftComment,
  UnplacedDrafts,
} from "../session/serverState";
import {
  CommentSides,
  ReviewCommentStatuses,
  isLineCommentAnchor,
  listDraftComments,
  type CommentSide,
  type ReviewComment,
} from "./comments";
import type { Receipt } from "./receipt";
import type { ReviewOutcome } from "./state";

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
  /** The review body, the receipt's one-line signature on the DB path. */
  body?: string;
}

const SIDE_TO_WIRE: Record<CommentSide, ThreadSide> = {
  [CommentSides.OLD]: ThreadSides.LEFT,
  [CommentSides.NEW]: ThreadSides.RIGHT,
};

/** The route's cap on the folded review body, in UTF-16 code units. */
export const MAX_BODY_LENGTH = 65_536;
const MAX_PATH_LENGTH = 1_024;

/**
 * The submit route's body. The drafts are NOT in it: the session holds them
 * already, so a re-submit ships exactly the rows GitHub never saw.
 */
export function buildSubmitPayload(
  input: BuildSubmitPayloadInput,
): SubmitPayload {
  const payload: SubmitPayload = { outcome: input.outcome };

  if (input.body !== undefined) payload.body = input.body;

  return payload;
}

/**
 * The submit transport's outcome, as the review flow renders it. Implemented
 * by `features/pulls/submitReview`; typed here so the review feature owns its
 * vocabulary.
 */
export type SubmitReviewResult =
  | {
      kind: "submitted";
      reviewId: number;
      /** Comments GitHub would not anchor, folded into the body; 0 = none. */
      commentsFolded: number;
      commentsTotal: number;
    }
  /** 409, the PR was rewritten since it was read; reload to re-anchor. */
  | { kind: "rewritten" }
  | { kind: "unauthorized" }
  | { kind: "not-found" }
  /** 409, a held draft's anchor no longer points at code; re-place or drop it. */
  | { kind: "orphaned-draft" }
  /** 400 (shape; programmer error) or deterministic 413, edit the body, retry-as-is never clears. */
  | { kind: "invalid" }
  /** 502/anything else, GitHub rejected or is unreachable. */
  /**
   * 403, a url-box brief for a repo the reader's own GitHub account cannot
   * write to. Never a retry: it clears by installing the App there.
   */
  | { kind: "no-write-access" }
  | { kind: "upstream" }
  /**
   * 504 from the web proxy: its budget ran out while the API was still
   * posting threads, so the review may land after this answer. Never a
   * plain retry.
   */
  | { kind: "indeterminate" }
  /** 409, the reader holds an unsubmitted review on GitHub; finish it there. */
  | { kind: "pending-review-held" };

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
 * only; never empty, GitHub requires a body for REQUEST_CHANGES, and this
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
 * Separator between the reviewer's own comment and the signature line,
 * GitHub renders `---` as a horizontal rule, fencing the tool's mechanical
 * claims off from the reviewer's words.
 */
const REVIEW_BODY_SEPARATOR = "\n\n---\n\n";

/**
 * The GitHub review body: the reviewer's free-text comment above the
 * signature line, separator-fenced; the signature alone when the comment is
 * empty (GitHub requires a nonempty body for REQUEST_CHANGES, the signature
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

interface FoldedRange {
  side: CommentSide;
  /** Present only when the range genuinely crosses sides. */
  startSide?: CommentSide;
  startLine: number;
  endLine: number;
}

/** One folded block's inputs, the shape both draft sources map onto. */
interface FoldedDraft {
  path: string;
  /** Absent on a file comment. */
  range?: FoldedRange;
  body: string;
}

/** The unplaced drafts the route still posts: the ones not yet submitted. */
export function listUnplacedDrafts(
  drafts: readonly SessionDraftComment[],
): UnplacedDrafts {
  return drafts.filter((draft) => draft.status === ReviewCommentStatuses.DRAFT);
}

function shapeFoldedDraft(draft: ReviewComment): FoldedDraft {
  const { anchor } = draft;
  const folded: FoldedDraft = { path: anchor.file, body: draft.body };
  const lineAnchored = isLineCommentAnchor(anchor);
  if (lineAnchored) {
    folded.range = anchor;
  }
  return folded;
}

function shapeUnplacedFoldedDraft(draft: SessionDraftComment): FoldedDraft {
  const folded: FoldedDraft = { path: draft.filePath, body: draft.body };
  if (draft.kind === CommentAnchorKinds.LINE) {
    folded.range = draft;
  }
  return folded;
}

function shapeFoldedRange(range: FoldedRange): string {
  const multiLine =
    range.startSide !== undefined || range.startLine < range.endLine;
  if (!multiLine) {
    return String(range.endLine);
  }
  const side = SIDE_TO_WIRE[range.side];
  const startSide = SIDE_TO_WIRE[range.startSide ?? range.side];
  if (startSide !== side) {
    return `${startSide} ${String(range.startLine)}-${side} ${String(range.endLine)}`;
  }
  return `${String(range.startLine)}-${String(range.endLine)}`;
}

function shapeFoldedBlock(draft: FoldedDraft): string {
  const location =
    draft.range === undefined
      ? draft.path
      : `${draft.path}:${shapeFoldedRange(draft.range)}`;
  return [`**\`${location}\`**`, "", draft.body].join("\n");
}

/** The folded review body, measured against `MAX_BODY_LENGTH`. */
export type FoldedReviewBody = string;

/**
 * The review body the route builds when GitHub rejects every anchor, the
 * worst case it measures against `MAX_BODY_LENGTH` before posting anything.
 * The route folds every held draft, placed or not; the length does not
 * depend on their order. The preamble is the route's GitHub-facing text,
 * measured here, never shown.
 */
export function foldDraftsIntoBody(
  reviewBody: string,
  drafts: readonly ReviewComment[],
  unplacedDrafts: readonly SessionDraftComment[],
): FoldedReviewBody {
  const folded = [
    ...drafts.map(shapeFoldedDraft),
    ...unplacedDrafts.map(shapeUnplacedFoldedDraft),
  ];
  if (folded.length === 0) {
    return reviewBody;
  }
  const count = String(folded.length);
  const preamble = `${count} of ${count} comments could not be anchored to the diff and were folded into this review body (nothing was dropped):`;
  const sections: string[] = [];
  const hasReviewBody = reviewBody.trim() !== "";
  if (hasReviewBody) {
    sections.push(reviewBody);
  }
  sections.push("---", preamble, ...folded.map(shapeFoldedBlock));
  return sections.join("\n\n");
}

export interface SubmitBlockInput {
  outcome: ReviewOutcome;
  comments: readonly ReviewComment[];
  /** Held drafts this Brief has no chunk for; the route posts them too. */
  unplacedDrafts: readonly SessionDraftComment[];
  /** The reviewer's own words, before the signature line is added. */
  reviewComment: string;
  /** What the route receives as `body`: `buildReviewBody` of the two. */
  reviewBody: string;
}

/**
 * Why Submit is refused, or `undefined` when it may proceed. The fold and
 * path checks mirror deterministic route 400s with recoverable copy, because
 * a retry resubmits the same drafts. GitHub rejects a content-free COMMENT;
 * verdicts supply their own content.
 */
export function submitBlockedReason(
  t: TFunction,
  input: SubmitBlockInput,
): string | undefined {
  const drafts = listDraftComments(input.comments);
  const unplacedDrafts = listUnplacedDrafts(input.unplacedDrafts);
  const hasReviewComment = input.reviewComment.trim() !== "";
  const heldDraftCount = drafts.length + unplacedDrafts.length;

  const foldLength = foldDraftsIntoBody(
    input.reviewBody,
    drafts,
    unplacedDrafts,
  ).length;
  if (foldLength > MAX_BODY_LENGTH) {
    return hasReviewComment
      ? t("review.submit.tooLargeWithReviewComment")
      : t("review.submit.tooLargeComments");
  }
  const overlongPath = drafts.find(
    (draft) => draft.anchor.file.length > MAX_PATH_LENGTH,
  );
  if (overlongPath !== undefined) {
    return t("review.submit.pathTooLong");
  }

  if (input.outcome !== "comment") {
    return undefined;
  }
  const contentFree = heldDraftCount === 0 && !hasReviewComment;
  if (contentFree) {
    return t("review.submit.commentNeedsContent");
  }
  return undefined;
}
