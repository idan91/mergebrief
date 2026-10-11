import type { Octokit } from "octokit";
import type { InstallationId } from "persistence";
import { getInstallationClient, type AppClient } from "../auth/app";
import { GitHubApiErrorCodes, type GitHubApiError } from "../errors";
import { buildAccountReader } from "./account-reader";
import { buildInstallationRepoClient } from "./installation-repo";
import type { CallRunner, InstallationGitHub } from "./types";

/** The message is static: nothing from the thrown mint error reaches it. */
function buildMintFailure(context: string): GitHubApiError {
  return {
    code: GitHubApiErrorCodes.REQUEST_FAILED,
    message: `failed to ${context}: installation client unavailable`,
  };
}

async function mintInstallationClient(
  app: AppClient,
  installationId: InstallationId,
): Promise<Octokit | undefined> {
  try {
    return await getInstallationClient(app, installationId);
  } catch {
    return undefined;
  }
}

/**
 * The App's GitHub on one installation. Each call asks octokit's `App` for
 * the installation client, which caches the minted token.
 */
export function bindInstallationGitHub(
  app: AppClient,
  installationId: InstallationId,
): InstallationGitHub {
  const run: CallRunner = async (call, context) => {
    const octokit = await mintInstallationClient(app, installationId);
    if (octokit === undefined) {
      return { ok: false, error: buildMintFailure(context) };
    }
    return call(octokit);
  };

  return {
    ...buildAccountReader(run),
    forRepo(repo) {
      return buildInstallationRepoClient(repo, run);
    },
  };
}
