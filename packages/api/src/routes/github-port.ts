// The installation-octokit interface (BRIEF-25; widened by BRIEF-94): every
// installation-token read this package performs enters through this port —
// injected by the startup wiring over the App-JWT client, substituted in
// tests. This package never constructs App auth itself. A shared installation
// token means one rate budget and one cache entry per resource, reused across
// viewers (ADR 0027) — viewer tokens would fragment both.
import {
  fetchPullRequestConversation,
  getInstallationClient,
  listRepoCollaborators,
  GitHubApiErrorCode,
  type AppClient,
  type FetchPullRequestConversationInput,
  type GitHubApiError,
  type ListRepoCollaboratorsInput,
  type PrConversation,
  type RepoCollaborators,
} from "github";
import type { InstallationId } from "persistence";
import type { Result } from "types";

/** The installation-token reads this package performs (test interface). */
export interface InstallationGitHubPort {
  fetchPullRequestConversation(
    installationId: InstallationId,
    input: FetchPullRequestConversationInput,
  ): Promise<Result<PrConversation, GitHubApiError>>;
  listRepoCollaborators(
    installationId: InstallationId,
    input: ListRepoCollaboratorsInput,
  ): Promise<Result<RepoCollaborators, GitHubApiError>>;
}

/**
 * The production port over `github`'s App-JWT client. Minting the
 * installation token talks to GitHub and can reject — that rejection must
 * become a sanitized Result (the route's 502), never an unhandled 500
 * outside the no-store policy (codex round 1). The static messages carry
 * nothing from the thrown error.
 */
function mintFailure(context: string): { ok: false; error: GitHubApiError } {
  return {
    ok: false,
    error: {
      code: GitHubApiErrorCode.REQUEST_FAILED,
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
  };
}
