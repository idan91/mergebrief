import { createReviewCommentReply } from "../operations/conversation";
import { createInlineReviewComment } from "../operations/inline-comment";
import { markPullRequestReadyForReview } from "../operations/mark-ready";
import { listOpenPullRequests } from "../operations/pull-request";
import type { RepositoryRef } from "../operations/pull-request/types";
import { setReviewThreadResolution } from "../operations/resolve-thread";
import { createPullRequestReview } from "../operations/review";
import { listReviewCommentsSince } from "../operations/review-comment-list";
import {
  countPendingReviewComments,
  deletePendingPullRequestReview,
  findPendingPullRequestReview,
  hasPullRequestReviewPublished,
  listReviewsByAuthor,
} from "../operations/review-pending";
import { submitPullRequestReview } from "../operations/review-submit";
import { addPullRequestReviewThread } from "../operations/review-thread";
import { buildRepoReader } from "./repo-reader";
import type { ReviewerRepoClient, ReviewerRunners } from "./types";

type ReviewerReads = Pick<
  ReviewerRepoClient,
  | "listOpenPullRequests"
  | "findPendingPullRequestReview"
  | "countPendingReviewComments"
  | "hasPullRequestReviewPublished"
  | "listReviewsByAuthor"
  | "listReviewCommentsSince"
>;

function buildReviewerReads(
  repo: RepositoryRef,
  { own }: ReviewerRunners,
): ReviewerReads {
  return {
    listOpenPullRequests() {
      return own(
        (octokit) => listOpenPullRequests(octokit, repo),
        "list open pull requests",
      );
    },
    findPendingPullRequestReview(prNumber) {
      return own(
        (octokit) =>
          findPendingPullRequestReview(octokit, { ...repo, prNumber }),
        "find pending pull request review",
      );
    },
    countPendingReviewComments(reviewNodeId) {
      return own(
        (octokit) => countPendingReviewComments(octokit, reviewNodeId),
        "count pending review comments",
      );
    },
    hasPullRequestReviewPublished(review) {
      return own(
        (octokit) =>
          hasPullRequestReviewPublished(octokit, { ...review, ...repo }),
        "check pull request review state",
      );
    },
    listReviewsByAuthor(input) {
      return own(
        (octokit) => listReviewsByAuthor(octokit, { ...input, ...repo }),
        "list reviews by author",
      );
    },
    listReviewCommentsSince(input) {
      return own(
        (octokit) => listReviewCommentsSince(octokit, { ...input, ...repo }),
        "list review comments",
      );
    },
  };
}

type ReviewerCreates = Pick<
  ReviewerRepoClient,
  | "createPullRequestReview"
  | "addPullRequestReviewThread"
  | "submitPullRequestReview"
  | "createInlineReviewComment"
  | "createReviewCommentReply"
>;

function buildReviewerCreates(
  repo: RepositoryRef,
  { create }: ReviewerRunners,
): ReviewerCreates {
  return {
    createPullRequestReview(input) {
      return create(
        (octokit) => createPullRequestReview(octokit, { ...input, ...repo }),
        "create pull request review",
      );
    },
    addPullRequestReviewThread(input) {
      return create(
        (octokit) => addPullRequestReviewThread(octokit, input),
        "add pull request review thread",
      );
    },
    submitPullRequestReview(input) {
      return create(
        (octokit) => submitPullRequestReview(octokit, input),
        "submit pull request review",
      );
    },
    createInlineReviewComment(input) {
      return create(
        (octokit) => createInlineReviewComment(octokit, { ...input, ...repo }),
        "create inline review comment",
      );
    },
    createReviewCommentReply(input) {
      return create(
        (octokit) => createReviewCommentReply(octokit, { ...input, ...repo }),
        "create review comment reply",
      );
    },
  };
}

type ReviewerConvergingWrites = Pick<
  ReviewerRepoClient,
  | "markPullRequestReadyForReview"
  | "setReviewThreadResolution"
  | "deletePendingPullRequestReview"
>;

/** A replay of these converges on the same state, so they keep retry on. */
function buildReviewerConvergingWrites(
  repo: RepositoryRef,
  { own }: ReviewerRunners,
): ReviewerConvergingWrites {
  return {
    markPullRequestReadyForReview(prNumber) {
      return own(
        (octokit) =>
          markPullRequestReadyForReview(octokit, { ...repo, prNumber }),
        "mark pull request ready for review",
      );
    },
    setReviewThreadResolution(input) {
      return own(
        (octokit) => setReviewThreadResolution(octokit, { ...input, ...repo }),
        "set review thread resolution",
      );
    },
    deletePendingPullRequestReview(review) {
      return own(
        (octokit) =>
          deletePendingPullRequestReview(octokit, { ...review, ...repo }),
        "delete pending pull request review",
      );
    },
  };
}

/**
 * Only the `RepoReader` reads may fall back to the operator token, each
 * within its reach; everything else runs on the reviewer's token only.
 */
export function buildReviewerRepoClient(
  repo: RepositoryRef,
  runners: ReviewerRunners,
): ReviewerRepoClient {
  return {
    ...buildRepoReader(repo, runners.read),
    ...buildReviewerReads(repo, runners),
    ...buildReviewerCreates(repo, runners),
    ...buildReviewerConvergingWrites(repo, runners),
  };
}
