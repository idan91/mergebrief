// The installation-octokit interface: every installation-token call this
// package performs enters through this port; injected by the startup wiring
// over the App-JWT client, substituted in tests. This package never constructs
// App auth itself. A shared installation token means one rate budget and one
// cache entry per resource, reused across viewers.
import {
  commitAttachment,
  fetchPullRequestConversation,
  getInstallationClient,
  listRepoCollaborators,
  GitHubApiErrorCodes,
  type AppClient,
  type AttachmentCommit,
  type CommitAttachmentInput,
  type FetchPullRequestConversationInput,
  type GitHubApiError,
  type ListRepoCollaboratorsInput,
  type PrConversation,
  type RepoCollaborators,
} from "github";
import type { InstallationId } from "persistence";
import type { Result } from "types/utils";

/** The installation-token calls this package performs (test interface). */
export interface InstallationGitHubPort {
  fetchPullRequestConversation(
    installationId: InstallationId,
    input: FetchPullRequestConversationInput,
  ): Promise<Result<PrConversation, GitHubApiError>>;
  listRepoCollaborators(
    installationId: InstallationId,
    input: ListRepoCollaboratorsInput,
  ): Promise<Result<RepoCollaborators, GitHubApiError>>;
  /** The one write: an image file onto the repository's attachments branch. */
  commitAttachment(
    installationId: InstallationId,
    input: CommitAttachmentInput,
  ): Promise<Result<AttachmentCommit, GitHubApiError>>;
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
    async fetchPullRequestConversation(installationId, input) {
      const octokit = await mintClient(installationId);
      if (octokit === undefined) {
        return mintFailure("fetch pull request conversation");
      }
      return fetchPullRequestConversation(octokit, input);
    },
    async listRepoCollaborators(installationId, input) {
      const octokit = await mintClient(installationId);
      if (octokit === undefined) {
        return mintFailure("list repo collaborators");
      }
      return listRepoCollaborators(octokit, input);
    },
    async commitAttachment(installationId, input) {
      const octokit = await mintClient(installationId);
      if (octokit === undefined) {
        return mintFailure("commit attachment");
      }
      return commitAttachment(octokit, input);
    },
  };
}
