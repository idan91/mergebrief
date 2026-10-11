// The attachment branch's installation-octokit interface, injected by the
// startup wiring over the App-JWT client and substituted in tests. Every
// other App-credential call binds through `AppDeps.bindInstallationGitHub`.
import {
  commitAttachment,
  deleteAttachmentBranch,
  getInstallationClient,
  GitHubApiErrorCodes,
  type AppClient,
  type AttachmentBranchDeletion,
  type AttachmentCommit,
  type CommitAttachmentInput,
  type DeleteAttachmentBranchInput,
  type GitHubApiError,
} from "github";
import type { InstallationId } from "persistence";
import type { Result } from "types/utils";

/** The attachment-branch calls on the installation token (test interface). */
export interface InstallationGitHubPort {
  /** The one write: an image file onto the repository's attachments branch. */
  commitAttachment(
    installationId: InstallationId,
    input: CommitAttachmentInput,
  ): Promise<Result<AttachmentCommit, GitHubApiError>>;
  /** Its undo: the whole branch, on a repository admin's confirmed word. */
  deleteAttachmentBranch(
    installationId: InstallationId,
    input: DeleteAttachmentBranchInput,
  ): Promise<Result<AttachmentBranchDeletion, GitHubApiError>>;
}

/**
 * Minting the installation token talks to GitHub and can reject; that
 * rejection must become a sanitized Result (the route's 502), never an
 * unhandled 500 outside the no-store policy. The static messages carry nothing
 * from the thrown error.
 */
function mintFailure(context: string): { ok: false; error: GitHubApiError } {
  return {
    ok: false,
    error: {
      code: GitHubApiErrorCodes.REQUEST_FAILED,
      message: `failed to ${context}: installation client unavailable`,
    },
  };
}

export function appInstallationPort(app: AppClient): InstallationGitHubPort {
  async function mintClient(
    installationId: InstallationId,
  ): Promise<Awaited<ReturnType<typeof getInstallationClient>> | undefined> {
    try {
      return await getInstallationClient(app, installationId);
    } catch {
      return undefined;
    }
  }

  return {
    async commitAttachment(installationId, input) {
      const octokit = await mintClient(installationId);
      if (octokit === undefined) {
        return mintFailure("commit attachment");
      }
      return commitAttachment(octokit, input);
    },
    async deleteAttachmentBranch(installationId, input) {
      const octokit = await mintClient(installationId);
      if (octokit === undefined) {
        return mintFailure("delete attachment branch");
      }
      return deleteAttachmentBranch(octokit, input);
    },
  };
}
