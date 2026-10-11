import { createUserOctokit } from "../auth/oauth";
import { fetchRepositoryById } from "../operations/repo";
import { buildRepoReader } from "./repo-reader";
import type {
  CallRunner,
  GitHubReader,
  OperatorBindingOptions,
  OperatorToken,
} from "./types";

export function isOperatorToken(value: string): value is OperatorToken {
  return value.length > 0;
}

/** The operator's token, read-only: nothing written on it reaches GitHub. */
export function bindOperatorGitHub(
  token: OperatorToken,
  options: OperatorBindingOptions = {},
): GitHubReader {
  const createOctokit = options.octokitFactory ?? createUserOctokit;
  const run: CallRunner = (call) => call(createOctokit(token));

  return {
    forRepo(repo) {
      return buildRepoReader(repo, run);
    },
    fetchRepositoryById(repoId) {
      return run(
        (octokit) => fetchRepositoryById(octokit, repoId),
        "fetch repository",
      );
    },
  };
}
