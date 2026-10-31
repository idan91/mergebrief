import { fetchRenderedImageSources } from "../operations/attachments";
import { fetchPullRequestConversation } from "../operations/conversation";
import {
  fetchCheckedCompareDiff,
  fetchCompareDiff,
  fetchCompareFiles,
  fetchDiff,
  fetchMergeBase,
  fetchPullRequest,
  fetchPullRequestFiles,
} from "../operations/pull-request";
import type { RepositoryRef } from "../operations/pull-request/types";
import { foldNotFoundToAbsent, getRepoFile } from "../operations/repo-file";
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
    fetchCheckedCompareDiff(span) {
      return run(
        (octokit) => fetchCheckedCompareDiff(octokit, { ...span, ...repo }),
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
    fetchMergeBase(span) {
      return run(
        (octokit) => fetchMergeBase(octokit, { ...span, ...repo }),
        "fetch merge base",
        { commits: [span.base, span.head] },
      );
    },
    async fetchRepoFile(input) {
      const result = await run(
        (octokit) => getRepoFile(octokit, { ...input, ...repo }),
        "fetch repo file",
        { commits: [input.ref] },
      );
      return foldNotFoundToAbsent(result);
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
