import { fetchIssue } from "../operations/issue";
import { readPullRequestFacts } from "../operations/live-read";
import { fetchRepositoryById } from "../operations/repo";
import type { AccountReader, CallRunner } from "./types";

export function buildAccountReader(run: CallRunner): AccountReader {
  return {
    fetchRepositoryById(repoId) {
      return run(
        (octokit) => fetchRepositoryById(octokit, repoId),
        "fetch repository",
      );
    },
    readPullRequestFacts(refs) {
      return run(
        (octokit) => readPullRequestFacts(octokit, refs),
        "read pull request facts",
      );
    },
    fetchIssue(ref) {
      return run((octokit) => fetchIssue(octokit, ref), "fetch issue");
    },
  };
}
