import type { InstallationRepoClient } from "../client/types";
import { CollaboratorPermissions } from "../operations/collaborator-permission/types";
import type { RepositoryRef } from "../operations/pull-request/types";
import { COMMIT_SHA_LENGTH } from "./consts";
import { buildRepoReader, listOpenPullRequests } from "./repo-reader";
import type { FakeRunner } from "./runners";
import { answerNotFound, answerOk, type FakeAnswer } from "./utils";
import type { FakeWorld } from "./world";

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
  };
}
