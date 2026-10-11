import { fetchPullRequest } from "../operations/pull-request";
import type { RepositoryRef } from "../operations/pull-request/types";
import type { CallRunner, RepoReader } from "./types";

/** The reads every credential shares, bound to one repository. */
export function buildRepoReader(
  repo: RepositoryRef,
  run: CallRunner,
): RepoReader {
  return {
    fetchPullRequest(prNumber) {
      return run(
        (octokit) => fetchPullRequest(octokit, { ...repo, prNumber }),
        "fetch pull request",
      );
    },
  };
}
