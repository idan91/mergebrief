import {
  commitAttachment,
  deleteAttachmentBranch,
} from "../operations/attachment-branch";
import { readCollaboratorPermission } from "../operations/collaborator-permission";
import { listRepoCollaborators } from "../operations/collaborators";
import {
  deleteComment,
  editComment,
  fetchComment,
  listIssueComments,
  postEntryComment,
} from "../operations/comments";
import { listOpenPullRequests } from "../operations/pull-request";
import type { ConfirmationReadOptions } from "../operations/deadline";
import { listSubmittedReviews } from "../operations/review-list";
import {
  listCheckRuns,
  listCommitStatuses,
  listRequiredStatusChecks,
} from "../operations/status-checks";
import type { RepositoryRef } from "../operations/pull-request/types";
import { buildRepoReader } from "./repo-reader";
import type { CallRunner, InstallationRepoClient } from "./types";

/**
 * Creates here ride the App client with octokit's retry on, so a 5xx can
 * replay an Entry comment or an attachment commit.
 */
export function buildInstallationRepoClient(
  repo: RepositoryRef,
  run: CallRunner,
  confirmationReads: ConfirmationReadOptions,
): InstallationRepoClient {
  return {
    ...buildRepoReader(repo, run),
    listRepoCollaborators() {
      return run(
        (octokit) => listRepoCollaborators(octokit, repo),
        "list repo collaborators",
      );
    },
    readCollaboratorPermission(login) {
      return run(
        (octokit) =>
          readCollaboratorPermission(octokit, {
            ...repo,
            ...confirmationReads,
            login,
          }),
        "read collaborator permission",
      );
    },
    listOpenPullRequests() {
      return run(
        (octokit) => listOpenPullRequests(octokit, repo),
        "list open pull requests",
      );
    },
    fetchComment(commentId) {
      return run(
        (octokit) => fetchComment(octokit, { ...repo, commentId }),
        "fetch comment",
      );
    },
    listIssueComments(prNumber) {
      return run(
        (octokit) => listIssueComments(octokit, { ...repo, prNumber }),
        "list comments",
      );
    },
    postEntryComment(input) {
      return run(
        (octokit) => postEntryComment(octokit, { ...input, ...repo }),
        "post entry comment",
      );
    },
    deleteComment(commentId) {
      return run(
        (octokit) => deleteComment(octokit, { ...repo, commentId }),
        "delete comment",
      );
    },
    editComment(commentId, body) {
      return run(
        (octokit) => editComment(octokit, { ...repo, commentId, body }),
        "edit comment",
      );
    },
    commitAttachment(input) {
      return run(
        (octokit) => commitAttachment(octokit, { ...input, ...repo }),
        "commit attachment",
      );
    },
    deleteAttachmentBranch(branch) {
      return run(
        (octokit) => deleteAttachmentBranch(octokit, { ...repo, branch }),
        "delete attachment branch",
      );
    },
    listCheckRuns(ref) {
      return run(
        (octokit) => listCheckRuns(octokit, { ...repo, ref }),
        "list check runs",
      );
    },
    listCommitStatuses(ref) {
      return run(
        (octokit) => listCommitStatuses(octokit, { ...repo, ref }),
        "list commit statuses",
      );
    },
    listSubmittedReviews(prNumber) {
      return run(
        (octokit) => listSubmittedReviews(octokit, { ...repo, prNumber }),
        "list pull request reviews",
      );
    },
    listRequiredStatusChecks(branch) {
      return run(
        (octokit) => listRequiredStatusChecks(octokit, { ...repo, branch }),
        "list branch rules",
      );
    },
  };
}
