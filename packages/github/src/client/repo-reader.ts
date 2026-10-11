import { fetchRenderedImageSources } from "../operations/attachments";
import { fetchPullRequestConversation } from "../operations/conversation";
import {
  fetchCompareDiff,
  fetchCompareFiles,
  fetchDiff,
  fetchPullRequest,
  fetchPullRequestFiles,
} from "../operations/pull-request";
import type { RepositoryRef } from "../operations/pull-request/types";
import { getRepoFile } from "../operations/repo-file";
import type { RepoReader, RepoReadRunner } from "./types";

export function buildRepoReader(
  repo: RepositoryRef,
  run: RepoReadRunner,
): RepoReader {
  return {
    fetchPullRequest(prNumber) {
      return run(
        (octokit) => fetchPullRequest(octokit, { ...repo, prNumber }),
        "fetch pull request",
        { prNumber },
      );
    },
    fetchPullRequestFiles(prNumber) {
      return run(
        (octokit) => fetchPullRequestFiles(octokit, { ...repo, prNumber }),
        "list pull request files",
        { prNumber },
      );
    },
    fetchDiff(prNumber) {
      return run(
        (octokit) => fetchDiff(octokit, { ...repo, prNumber }),
        "fetch diff",
        { prNumber },
      );
    },
    fetchCompareDiff(span) {
      return run(
        (octokit) => fetchCompareDiff(octokit, { ...span, ...repo }),
        "fetch compare diff",
        { commits: [span.base, span.head] },
      );
    },
    fetchCompareFiles(span) {
      return run(
        (octokit) => fetchCompareFiles(octokit, { ...span, ...repo }),
        "fetch compare files",
        { commits: [span.base, span.head] },
      );
    },
    fetchRepoFile(input) {
      return run(
        (octokit) => getRepoFile(octokit, { ...input, ...repo }),
        "fetch repo file",
        { commits: [input.ref] },
      );
    },
    fetchPullRequestConversation(prNumber) {
      return run(
        (octokit) =>
          fetchPullRequestConversation(octokit, { ...repo, prNumber }),
        "fetch pull request conversation",
        { prNumber },
      );
    },
    fetchRenderedImageSources(prNumber) {
      return run(
        (octokit) => fetchRenderedImageSources(octokit, { ...repo, prNumber }),
        "fetch rendered image sources",
        { prNumber },
      );
    },
  };
}
