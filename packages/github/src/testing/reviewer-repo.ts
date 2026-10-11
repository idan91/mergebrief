import { HttpStatuses } from "types/http";
import type { Mutable } from "types/utils";
import type { ReviewerRepoClient } from "../client/types";
import { GitHubApiErrorCodes } from "../errors";
import type { RepositoryRef } from "../operations/pull-request/types";
import {
  PullRequestReviewStates,
  type AuthoredReview,
} from "../operations/review-pending";
import { SUBMITTED_STATES } from "./consts";
import {
  buildRepoReader,
  listOpenPullRequests,
  readPullRequest,
} from "./repo-reader";
import type { FakeRunner } from "./runners";
import type { FakeReview } from "./types";
import {
  answerAnchorRejected,
  answerNotFound,
  answerOk,
  type FakeAnswer,
} from "./utils";
import type { FakeWorld, PullRequestState } from "./world";

const PENDING_REVIEW_EXISTS = {
  code: GitHubApiErrorCodes.PENDING_REVIEW_EXISTS,
  status: HttpStatuses.UNPROCESSABLE_CONTENT,
  message:
    "failed to create pull request review: GitHub API returned status 422",
} as const;

interface PendingMatch {
  readonly pull: PullRequestState;
  readonly review: FakeReview;
}

function isPending(review: FakeReview): boolean {
  return review.state === PullRequestReviewStates.PENDING;
}

function findPendingByNodeId(
  world: FakeWorld,
  repo: RepositoryRef,
  reviewNodeId: string,
): PendingMatch | undefined {
  for (const pull of world.findRepo(repo)?.pullRequests.values() ?? []) {
    const review = pull.reviews.find(
      (candidate) => candidate.reviewNodeId === reviewNodeId,
    );
    if (review !== undefined && isPending(review)) {
      return { pull, review };
    }
  }
  return undefined;
}

function replaceReview(match: PendingMatch, next: FakeReview): void {
  match.pull.reviews = match.pull.reviews.map((review) =>
    review === match.review ? next : review,
  );
}

function shapeAuthoredReview(review: FakeReview): AuthoredReview {
  const authored: Mutable<AuthoredReview> = {
    reviewId: review.reviewId,
    state: review.state,
    body: review.body,
  };
  if (review.submittedAt !== undefined) {
    authored.submittedAt = review.submittedAt;
  }
  return authored;
}

/** A review GitHub opens around a single comment or a reply. */
function openCommentReview(world: FakeWorld, pull: PullRequestState): bigint {
  const reviewId = world.claimId("REVIEW");
  pull.reviews.push({
    reviewId,
    reviewNodeId: `PRR_${reviewId}`,
    state: PullRequestReviewStates.COMMENTED,
    body: "",
    commentCount: 1,
  });
  return reviewId;
}

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
  world: FakeWorld,
  repo: RepositoryRef,
  run: FakeRunner,
): ReviewerReads {
  return {
    listOpenPullRequests() {
      return run({
        operation: "listOpenPullRequests",
        input: repo,
        answer: () => listOpenPullRequests(world, repo),
      });
    },
    findPendingPullRequestReview(prNumber) {
      const input = { ...repo, prNumber };
      return run({
        operation: "findPendingPullRequestReview",
        input,
        answer: () =>
          readPullRequest(world, input, (pull) => {
            const pending = pull.reviews.find(isPending);
            if (pending === undefined) {
              return undefined;
            }
            const { reviewId, reviewNodeId } = pending;
            return { reviewId, reviewNodeId };
          }),
      });
    },
    countPendingReviewComments(reviewNodeId) {
      return run({
        operation: "countPendingReviewComments",
        input: { reviewNodeId },
        answer: () => {
          const match = findPendingByNodeId(world, repo, reviewNodeId);
          if (match === undefined) {
            return answerNotFound("count pending review comments");
          }
          return answerOk(match.review.commentCount ?? 0);
        },
      });
    },
    hasPullRequestReviewPublished(review) {
      const input = { ...review, ...repo };
      return run({
        operation: "hasPullRequestReviewPublished",
        input,
        answer: () =>
          readPullRequest(world, input, (pull) =>
            pull.reviews.some(
              (listed) =>
                listed.reviewId === review.reviewId && !isPending(listed),
            ),
          ),
      });
    },
    listReviewsByAuthor(author) {
      const input = { ...author, ...repo };
      return run({
        operation: "listReviewsByAuthor",
        input,
        answer: () =>
          readPullRequest(world, input, (pull) =>
            pull.reviews
              .filter((review) => review.authorId === author.authorId)
              .map(shapeAuthoredReview),
          ),
      });
    },
    listReviewCommentsSince(window) {
      const input = { ...window, ...repo };
      return run({
        operation: "listReviewCommentsSince",
        input,
        answer: () =>
          readPullRequest(world, input, (pull) => pull.reviewComments),
      });
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
  world: FakeWorld,
  repo: RepositoryRef,
  run: FakeRunner,
): ReviewerCreates {
  return {
    createPullRequestReview(review) {
      const input = { ...review, ...repo };
      return run({
        operation: "createPullRequestReview",
        input,
        answer: () => {
          const pull = world.findPullRequest(input);
          if (pull === undefined) {
            return answerNotFound("create pull request review");
          }
          if (pull.reviews.some(isPending)) {
            return { ok: false, error: PENDING_REVIEW_EXISTS };
          }
          const reviewId = world.claimId("REVIEW");
          const reviewNodeId = `PRR_${reviewId}`;
          pull.reviews.push({
            reviewId,
            reviewNodeId,
            state: PullRequestReviewStates.PENDING,
            body: "",
            commentCount: 0,
          });
          return answerOk({ reviewId, reviewNodeId });
        },
      });
    },
    addPullRequestReviewThread(thread) {
      return run({
        operation: "addPullRequestReviewThread",
        input: thread,
        answer: () => {
          const match = findPendingByNodeId(world, repo, thread.reviewNodeId);
          if (match === undefined) {
            return answerNotFound("add pull request review thread");
          }
          if (match.pull.rejectedAnchorPaths.has(thread.path)) {
            return answerAnchorRejected("add pull request review thread");
          }
          const commentCount = (match.review.commentCount ?? 0) + 1;
          replaceReview(match, { ...match.review, commentCount });
          return answerOk({ threadId: `PRRT_${world.claimId("THREAD")}` });
        },
      });
    },
    submitPullRequestReview(submit) {
      return run({
        operation: "submitPullRequestReview",
        input: submit,
        answer: (): FakeAnswer<void> => {
          const match = findPendingByNodeId(world, repo, submit.reviewNodeId);
          if (match === undefined) {
            return answerNotFound("submit pull request review");
          }
          replaceReview(match, {
            ...match.review,
            state: SUBMITTED_STATES[submit.event],
            body: submit.body ?? "",
          });
          return answerOk(undefined);
        },
      });
    },
    createInlineReviewComment(comment) {
      const input = { ...comment, ...repo };
      return run({
        operation: "createInlineReviewComment",
        input,
        answer: () => {
          const pull = world.findPullRequest(input);
          if (pull === undefined) {
            return answerNotFound("create inline review comment");
          }
          if (pull.rejectedAnchorPaths.has(input.path)) {
            return answerAnchorRejected("create inline review comment");
          }
          const commentId = world.claimId("REVIEW_COMMENT");
          return answerOk({
            commentId,
            reviewId: openCommentReview(world, pull),
          });
        },
      });
    },
    createReviewCommentReply(reply) {
      const input = { ...reply, ...repo };
      return run({
        operation: "createReviewCommentReply",
        input,
        answer: () => {
          const pull = world.findPullRequest(input);
          if (pull === undefined) {
            return answerNotFound("create review comment reply");
          }
          const commentId = Number(world.claimId("REVIEW_COMMENT"));
          const reviewId = Number(openCommentReview(world, pull));
          return answerOk({ commentId, reviewId });
        },
      });
    },
  };
}

type ReviewerConvergingWrites = Pick<
  ReviewerRepoClient,
  | "markPullRequestReadyForReview"
  | "setReviewThreadResolution"
  | "deletePendingPullRequestReview"
>;

function buildReviewerConvergingWrites(
  world: FakeWorld,
  repo: RepositoryRef,
  run: FakeRunner,
): ReviewerConvergingWrites {
  return {
    markPullRequestReadyForReview(prNumber) {
      const input = { ...repo, prNumber };
      return run({
        operation: "markPullRequestReadyForReview",
        input,
        answer: () =>
          readPullRequest(world, input, (pull) => {
            const alreadyReady = !pull.info.draft;
            pull.info = { ...pull.info, draft: false };
            return { alreadyReady };
          }),
      });
    },
    setReviewThreadResolution(resolution) {
      const input = { ...resolution, ...repo };
      return run({
        operation: "setReviewThreadResolution",
        input,
        answer: () => {
          const pull = world.findPullRequest(input);
          const thread = pull?.conversation.threads.find(
            (candidate) => candidate.rootCommentId === input.rootCommentId,
          );
          if (pull === undefined || thread === undefined) {
            return answerNotFound("set review thread resolution");
          }
          const threads = pull.conversation.threads.map((candidate) =>
            candidate === thread
              ? { ...thread, isResolved: input.resolved }
              : candidate,
          );
          pull.conversation = { ...pull.conversation, threads };
          return answerOk({
            alreadyInTargetState: thread.isResolved === input.resolved,
          });
        },
      });
    },
    deletePendingPullRequestReview(review) {
      const input = { ...review, ...repo };
      return run({
        operation: "deletePendingPullRequestReview",
        input,
        onNotFound: () => undefined,
        answer: (): FakeAnswer<void> => {
          const pull = world.findPullRequest(input);
          const pending = pull?.reviews.find(
            (listed) =>
              listed.reviewId === review.reviewId && isPending(listed),
          );
          if (pull === undefined || pending === undefined) {
            return answerNotFound("delete pending pull request review");
          }
          pull.reviews = pull.reviews.filter((listed) => listed !== pending);
          return answerOk(undefined);
        },
      });
    },
  };
}

export interface ReviewerRepoRunners {
  /** Reads with the operator fallback, when the binding has one. */
  readonly read: FakeRunner;
  readonly own: FakeRunner;
}

/** Only the `RepoReader` reads carry a reach, so only they reach the operator. */
export function buildReviewerRepoClient(
  world: FakeWorld,
  repo: RepositoryRef,
  runners: ReviewerRepoRunners,
): ReviewerRepoClient {
  return {
    ...buildRepoReader(world, repo, runners.read),
    ...buildReviewerReads(world, repo, runners.own),
    ...buildReviewerCreates(world, repo, runners.own),
    ...buildReviewerConvergingWrites(world, repo, runners.own),
  };
}
