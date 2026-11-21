// Pull-request read primitives: PR metadata and the unified diff. The diff
// uses the `application/vnd.github.diff` media type, which returns the raw
// diff as a string body. Failures are sanitized via `mapRequestError`.
import type { Octokit } from "octokit";
import type { OpenPullRequest, RepoIdentity } from "brief-core/pr-stack";
import type { Mutable, Result } from "types/utils";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../../errors";
import { repoIdSchema } from "../../ids";
import { GitHubAccountTypes } from "../../types";
import { isPrivateRepository } from "../repo-visibility";

import {
  compareMergeBaseSchema,
  gitHubRepoSchema,
  openPullRequestListSchema,
  type OpenPullRequestRow,
} from "./schemas";
import {
  PullRequestFileStatuses,
  type CommitRef,
  type CompareDiffRef,
  type PullRequestFile,
  type PullRequestFileStatus,
  type PullRequestInfo,
  type PullRequestRef,
  type RepositoryRef,
} from "./types";

export { fetchCheckedCompareDiff } from "./checked-compare-diff";
export type {
  CommitRef,
  CompareDiffRef,
  PullRequestFile,
  PullRequestInfo,
  PullRequestRef,
  RepositoryRef,
} from "./types";

/** Fetch the PR fields the webhook mapping and generation inputs need. */
export async function fetchPullRequest(
  octokit: Octokit,
  ref: PullRequestRef,
): Promise<Result<PullRequestInfo, GitHubApiError>> {
  try {
    const response = await octokit.rest.pulls.get({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.prNumber,
    });
    const data = response.data;
    const repoId = repoIdSchema.safeParse(data.base.repo.id);
    if (!repoId.success) {
      return {
        ok: false,
        error: unexpectedResponseError("fetch pull request"),
      };
    }
    const info: Mutable<PullRequestInfo> = {
      repoId: repoId.data,
      repoFullName: data.base.repo.full_name,
      repoPrivate: isPrivateRepository(data.base.repo),
      headSha: data.head.sha,
      headRef: data.head.ref,
      baseSha: data.base.sha,
      state: data.state,
      draft: data.draft ?? false,
      merged: data.merged,
      title: data.title,
      body: data.body ?? "",
      htmlUrl: data.html_url,
      commitCount: data.commits,
      changedFiles: data.changed_files,
      additions: data.additions,
      deletions: data.deletions,
      labels: data.labels.map((label) => label.name),
      pendingReviewRequests: countPendingReviewRequests(data),
      authorLogin: data.user?.login ?? null,
      authorIsBot: data.user?.type === GitHubAccountTypes.BOT,
      closedAt: data.closed_at === null ? null : new Date(data.closed_at),
      updatedAt: new Date(data.updated_at),
      createdAt: new Date(data.created_at),
    };
    if (typeof data.base.ref === "string" && data.base.ref !== "") {
      info.baseRef = data.base.ref;
    }
    const baseRepo = readRepoIdentity(data.base.repo);
    if (baseRepo !== undefined) {
      info.baseRepo = baseRepo;
    }
    const headRepo = readRepoIdentity(data.head.repo);
    if (headRepo !== undefined) {
      info.headRepo = headRepo;
    }
    return {
      ok: true,
      value: info,
    };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "fetch pull request") };
  }
}

interface ReviewRequestLists {
  readonly requested_reviewers?: readonly { readonly type?: string }[] | null;
  readonly requested_teams?: readonly unknown[] | null;
}

/**
 * GitHub drops a reviewer from the lists once their review lands. A bot's
 * request is a review tool's, never a person's.
 */
function countPendingReviewRequests(lists: ReviewRequestLists): number {
  const reviewers = lists.requested_reviewers ?? [];
  const people = reviewers.filter(
    (reviewer) => reviewer.type !== GitHubAccountTypes.BOT,
  );
  const teams = lists.requested_teams?.length ?? 0;
  return people.length + teams;
}

interface ListedPullRequestFile {
  readonly filename: string;
  readonly previous_filename?: string;
  readonly status: PullRequestFileStatus;
  readonly additions: number;
  readonly deletions: number;
}

function mapPullRequestFile(file: ListedPullRequestFile): PullRequestFile {
  const mapped: Mutable<PullRequestFile> = {
    path: file.filename,
    additions: file.additions,
    deletions: file.deletions,
  };
  const renamed = file.status === PullRequestFileStatuses.RENAMED;
  if (renamed && file.previous_filename !== undefined) {
    mapped.previousPath = file.previous_filename;
  }
  return mapped;
}

/**
 * List a PR's changed files, the per-file generation input and the whole-PR
 * churn denominator for the huge-span heuristic.
 */
export async function fetchPullRequestFiles(
  octokit: Octokit,
  ref: PullRequestRef,
): Promise<Result<PullRequestFile[], GitHubApiError>> {
  try {
    const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.prNumber,
      per_page: 100,
    });
    return {
      ok: true,
      value: files.map(mapPullRequestFile),
    };
  } catch (error) {
    return {
      ok: false,
      error: mapRequestError(error, "list pull request files"),
    };
  }
}

function readRepoIdentity(repo: unknown): RepoIdentity | undefined {
  const parsed = gitHubRepoSchema.safeParse(repo);
  if (!parsed.success) {
    return undefined;
  }
  return { owner: parsed.data.owner.login, repo: parsed.data.name };
}

function mapListedPullRequest(
  item: OpenPullRequestRow,
): OpenPullRequest | undefined {
  if (item.head.repo === null) {
    return undefined;
  }
  return {
    number: item.number,
    title: item.title,
    draft: item.draft ?? false,
    headRef: item.head.ref,
    baseRef: item.base.ref,
    headRepo: {
      owner: item.head.repo.owner.login,
      repo: item.head.repo.name,
    },
    baseRepo: {
      owner: item.base.repo.owner.login,
      repo: item.base.repo.name,
    },
  };
}

export async function listOpenPullRequests(
  octokit: Octokit,
  repo: RepositoryRef,
): Promise<Result<OpenPullRequest[], GitHubApiError>> {
  try {
    const listed = await octokit.paginate(octokit.rest.pulls.list, {
      owner: repo.owner,
      repo: repo.repo,
      state: "open",
      per_page: 100,
    });
    const parsed = openPullRequestListSchema.safeParse(listed);
    if (!parsed.success) {
      return {
        ok: false,
        error: unexpectedResponseError("list open pull requests"),
      };
    }
    const value: OpenPullRequest[] = [];
    for (const item of parsed.data) {
      const mapped = mapListedPullRequest(item);
      if (mapped !== undefined) {
        value.push(mapped);
      }
    }
    return {
      ok: true,
      value,
    };
  } catch (error) {
    return {
      ok: false,
      error: mapRequestError(error, "list open pull requests"),
    };
  }
}

/**
 * Fetch a PR's unified diff. octokit types the `diff` media-type response as
 * the PR object, so the runtime string is narrowed here.
 */
export async function fetchDiff(
  octokit: Octokit,
  ref: PullRequestRef,
): Promise<Result<string, GitHubApiError>> {
  try {
    const response = await octokit.rest.pulls.get({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.prNumber,
      mediaType: { format: "diff" },
    });
    const body: unknown = response.data;
    if (typeof body !== "string") {
      return { ok: false, error: unexpectedResponseError("fetch diff") };
    }
    return { ok: true, value: body };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "fetch diff") };
  }
}

/**
 * List a PR's review comments as RAW wire objects, fully paginated.
 * Deliberately unvalidated here: brief-core's `normalizeReviewComment` is the
 * single boundary parser for this shape, and a second Zod shape would drift
 * from it. Callers normalize, never trust.
 */
export async function fetchReviewCommentsRaw(
  octokit: Octokit,
  ref: PullRequestRef,
): Promise<Result<unknown[], GitHubApiError>> {
  try {
    const comments = await octokit.paginate(
      octokit.rest.pulls.listReviewComments,
      {
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.prNumber,
        per_page: 100,
      },
    );
    return { ok: true, value: comments };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "list review comments") };
  }
}

/**
 * Count the commits in a `base...head` span. `total_commits` is the span total
 * independent of pagination, so `per_page: 1` keeps the response minimal.
 */
export async function fetchCompareCommitCount(
  octokit: Octokit,
  ref: CompareDiffRef,
): Promise<Result<number, GitHubApiError>> {
  try {
    const response = await octokit.rest.repos.compareCommitsWithBasehead({
      owner: ref.owner,
      repo: ref.repo,
      basehead: `${ref.base}...${ref.head}`,
      per_page: 1,
    });
    return { ok: true, value: response.data.total_commits };
  } catch (error) {
    return {
      ok: false,
      error: mapRequestError(error, "fetch compare commit count"),
    };
  }
}

/**
 * The merge base of a `base...head` span: the commit a three-dot diff, the
 * PR diff included, is taken from. `per_page: 1` keeps the response minimal.
 */
export async function fetchMergeBase(
  octokit: Octokit,
  ref: CompareDiffRef,
): Promise<Result<string, GitHubApiError>> {
  let body: unknown;
  try {
    const response = await octokit.rest.repos.compareCommitsWithBasehead({
      owner: ref.owner,
      repo: ref.repo,
      basehead: `${ref.base}...${ref.head}`,
      per_page: 1,
    });
    body = response.data;
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "fetch merge base") };
  }
  const parsed = compareMergeBaseSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: unexpectedResponseError("fetch merge base") };
  }
  return { ok: true, value: parsed.data.merge_base_commit.sha };
}

/**
 * Resolve a possibly-abbreviated commit-ish to its full 40-char SHA,
 * artifacts are keyed by full SHAs and joined by exact equality.
 */
export async function resolveCommitSha(
  octokit: Octokit,
  ref: CommitRef,
): Promise<Result<string, GitHubApiError>> {
  try {
    const response = await octokit.rest.repos.getCommit({
      owner: ref.owner,
      repo: ref.repo,
      ref: ref.ref,
    });
    return { ok: true, value: response.data.sha };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "resolve commit sha") };
  }
}

/**
 * Fetch the unified diff for an explicit `base...head` span, so the response
 * is exactly the requested range rather than the whole-PR diff.
 */
export async function fetchCompareDiff(
  octokit: Octokit,
  ref: CompareDiffRef,
): Promise<Result<string, GitHubApiError>> {
  try {
    const response = await octokit.rest.repos.compareCommitsWithBasehead({
      owner: ref.owner,
      repo: ref.repo,
      basehead: `${ref.base}...${ref.head}`,
      mediaType: { format: "diff" },
    });
    const body: unknown = response.data;
    if (typeof body !== "string") {
      return {
        ok: false,
        error: unexpectedResponseError("fetch compare diff"),
      };
    }
    return { ok: true, value: body };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "fetch compare diff") };
  }
}
