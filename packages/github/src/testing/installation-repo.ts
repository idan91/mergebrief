import type { Mutable } from "types/utils";
import type { InstallationRepoClient } from "../client/types";
import type { IssueComment } from "../operations/comments";
import { CollaboratorPermissions } from "../operations/collaborator-permission/types";
import type { RepositoryRef } from "../operations/pull-request/types";
import type { SubmittedReview } from "../operations/review-list";
import {
  PullRequestReviewStates,
  type PullRequestReviewState,
} from "../operations/review";
import type { ReviewVerdictState } from "types/conversation";
import { COMMIT_SHA_LENGTH, FAKE_APP_BOT_USER_ID } from "./consts";
import { buildRepoReader, listOpenPullRequests } from "./repo-reader";
import type { FakeRunner } from "./runners";
import { answerNotFound, answerOk, type FakeAnswer } from "./utils";
import type { FakeReview } from "./types";
import type { FakeWorld, RepoState } from "./world";

/** The PR's live comments in id order, the order GitHub lists them. */
function listThreadComments(
  state: RepoState,
  prNumber: number,
): IssueComment[] {
  const listed: IssueComment[] = [];
  for (const [commentId, body] of state.comments) {
    const thread = state.commentThreads.get(commentId);
    if (thread?.prNumber === prNumber) {
      listed.push({ commentId, authorId: thread.authorId, body });
    }
  }
  return listed.toSorted((left, right) =>
    Number(left.commentId - right.commentId),
  );
}

function readSubmittedState(
  state: PullRequestReviewState,
): ReviewVerdictState | undefined {
  if (state === PullRequestReviewStates.PENDING) {
    return undefined;
  }
  return state;
}

/** GitHub lists a pull request's reviews oldest first, a pending draft only to its author. */
function listSubmittedReviews(
  reviews: readonly FakeReview[],
): SubmittedReview[] {
  const submitted: SubmittedReview[] = [];
  for (const review of reviews) {
    const state = readSubmittedState(review.state);
    if (state === undefined) {
      continue;
    }
    const listed: Mutable<SubmittedReview> = {
      reviewId: review.reviewId,
      state,
    };
    if (review.authorId !== undefined) {
      listed.authorId = review.authorId;
    }
    if (review.authorLogin !== undefined) {
      listed.authorLogin = review.authorLogin;
    }
    if (review.authorType !== undefined) {
      listed.authorType = review.authorType;
    }
    if (review.authorAssociation !== undefined) {
      listed.authorAssociation = review.authorAssociation;
    }
    if (review.commitId !== undefined) {
      listed.commitId = review.commitId;
    }
    submitted.push(listed);
  }
  return submitted;
}

export function buildInstallationRepoClient(
  world: FakeWorld,
  repo: RepositoryRef,
  run: FakeRunner,
): InstallationRepoClient {
  return {
    ...buildRepoReader(world, repo, run),
    listRepoCollaborators() {
      return run({
        operation: "listRepoCollaborators",
        input: repo,
        answer: () => {
          const state = world.findRepo(repo);
          if (state === undefined) {
            return answerNotFound("list repo collaborators");
          }
          return answerOk(state.collaborators);
        },
      });
    },
    readCollaboratorPermission(login) {
      return run({
        operation: "readCollaboratorPermission",
        input: { ...repo, login },
        answer: () => {
          const state = world.findRepo(repo);
          if (state === undefined) {
            return answerNotFound("read collaborator permission");
          }
          const permission = state.collaboratorPermissions.get(
            login.toLowerCase(),
          );
          return answerOk(permission ?? CollaboratorPermissions.NONE);
        },
      });
    },
    listOpenPullRequests() {
      return run({
        operation: "listOpenPullRequests",
        input: repo,
        answer: () => listOpenPullRequests(world, repo),
      });
    },
    fetchComment(commentId) {
      return run({
        operation: "fetchComment",
        input: { ...repo, commentId },
        onNotFound: () => undefined,
        answer: () => {
          const body = world.findRepo(repo)?.comments.get(commentId);
          if (body === undefined) {
            return answerNotFound("fetch comment");
          }
          return answerOk({ body });
        },
      });
    },
    listIssueComments(prNumber) {
      return run({
        operation: "listIssueComments",
        input: { ...repo, prNumber },
        answer: () => {
          const state = world.findRepo(repo);
          if (state?.pullRequests.has(prNumber) !== true) {
            return answerNotFound("list comments");
          }
          return answerOk(listThreadComments(state, prNumber));
        },
      });
    },
    postEntryComment(comment) {
      const input = { ...comment, ...repo };
      return run({
        operation: "postEntryComment",
        input,
        answer: () => {
          const state = world.findRepo(repo);
          if (state?.pullRequests.has(input.prNumber) !== true) {
            return answerNotFound("post entry comment");
          }
          const commentId = world.claimId("ISSUE_COMMENT");
          state.comments.set(commentId, input.body);
          state.commentThreads.set(commentId, {
            prNumber: input.prNumber,
            authorId: FAKE_APP_BOT_USER_ID,
          });
          return answerOk({ commentId });
        },
      });
    },
    deleteComment(commentId) {
      return run({
        operation: "deleteComment",
        input: { ...repo, commentId },
        onNotFound: () => undefined,
        answer: (): FakeAnswer<void> => {
          const deleted = world.findRepo(repo)?.comments.delete(commentId);
          if (deleted !== true) {
            return answerNotFound("delete comment");
          }
          return answerOk(undefined);
        },
      });
    },
    editComment(commentId, body) {
      return run({
        operation: "editComment",
        input: { ...repo, commentId, body },
        onNotFound: () => false,
        answer: (): FakeAnswer<boolean> => {
          const comments = world.findRepo(repo)?.comments;
          if (comments?.has(commentId) !== true) {
            return answerNotFound("edit comment");
          }
          comments.set(commentId, body);
          return answerOk(true);
        },
      });
    },
    commitAttachment(attachment) {
      const input = { ...attachment, ...repo };
      return run({
        operation: "commitAttachment",
        input,
        answer: () => {
          const state = world.findRepo(repo);
          if (state === undefined) {
            return answerNotFound("commit attachment");
          }
          state.branches.add(input.branch);
          const commit = world.claimId("COMMIT").toString(16);
          return answerOk({
            commitSha: commit.padStart(COMMIT_SHA_LENGTH, "0"),
          });
        },
      });
    },
    deleteAttachmentBranch(branch) {
      return run({
        operation: "deleteAttachmentBranch",
        input: { ...repo, branch },
        answer: () => {
          const existed =
            world.findRepo(repo)?.branches.delete(branch) === true;
          return answerOk({ existed });
        },
      });
    },
    listCheckRuns(ref) {
      return run({
        operation: "listCheckRuns",
        input: { ...repo, ref },
        answer: () => {
          const state = world.findRepo(repo);
          if (state === undefined) {
            return answerNotFound("list check runs");
          }
          return answerOk([...(state.checkRuns.get(ref) ?? [])]);
        },
      });
    },
    listCommitStatuses(ref) {
      return run({
        operation: "listCommitStatuses",
        input: { ...repo, ref },
        answer: () => {
          const state = world.findRepo(repo);
          if (state === undefined) {
            return answerNotFound("list commit statuses");
          }
          const statuses = state.commitStatuses.get(ref) ?? [];
          return answerOk(statuses.toReversed());
        },
      });
    },
    listSubmittedReviews(prNumber) {
      return run({
        operation: "listSubmittedReviews",
        input: { ...repo, prNumber },
        answer: () => {
          const pull = world.findPullRequest({ ...repo, prNumber });
          if (pull === undefined) {
            return answerNotFound("list pull request reviews");
          }
          return answerOk(listSubmittedReviews(pull.reviews));
        },
      });
    },
    listRequiredStatusChecks(branch) {
      return run({
        operation: "listRequiredStatusChecks",
        input: { ...repo, branch },
        answer: () => {
          const state = world.findRepo(repo);
          if (state === undefined) {
            return answerNotFound("list branch rules");
          }
          return answerOk([...(state.requiredStatusChecks.get(branch) ?? [])]);
        },
      });
    },
  };
}
