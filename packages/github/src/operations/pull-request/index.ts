// Pull-request read primitives: PR metadata and the unified diff. The diff
// uses the `application/vnd.github.diff` media type, which returns the raw
// diff as a string body. Failures are sanitized via `mapRequestError`.
import type { Octokit } from "octokit";
import type { CompareFile, CompareFiles, RepoIdentity } from "brief-core";
import type { Mutable } from "types/utils";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../../errors";
import { repoIdSchema } from "../../ids";
import type { Result } from "../../types";

import {
  compareFilesSchema,
  gitHubRepoSchema,
  openPullRequestListSchema,
  type OpenPullRequestRow,
} from "./schemas";
import type {
  CommitRef,
  CompareDiffRef,
  OpenPullRequest,
  PullRequestFile,
  PullRequestInfo,
  PullRequestRef,
  RepositoryRef,
} from "./types";

export type {
  CommitRef,
  CompareDiffRef,
  OpenPullRequest,
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
      authorLogin: data.user?.login ?? null,
      closedAt: data.closed_at === null ? null : new Date(data.closed_at),
      updatedAt: new Date(data.updated_at),
    };
    if (typeof data.base.ref === "string" && data.base.ref !== "") {
      info.baseRef = data.base.ref;
    }
    const baseRepo = readRepoIdentity(data.base.repo);
    if (baseRepo !== undefined) info.baseRepo = baseRepo;
    const headRepo = readRepoIdentity(data.head.repo);
    if (headRepo !== undefined) info.headRepo = headRepo;
    return {
      ok: true,
      value: info,
    };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "fetch pull request") };
  }
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
      value: files.map((file) => ({
        path: file.filename,
        additions: file.additions,
        deletions: file.deletions,
      })),
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
  if (!parsed.success) return undefined;
  return { owner: parsed.data.owner.login, repo: parsed.data.name };
}

function mapListedPullRequest(
  item: OpenPullRequestRow,
): OpenPullRequest | undefined {
  if (item.head.repo === null) return undefined;
  return {
    number: item.number,
    title: item.title,
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
      if (mapped !== undefined) value.push(mapped);
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

/** GitHub caps the compare response's `files[]` at this many entries. */
const COMPARE_FILES_CAP = 300;

/**
 * Per-file JSON metadata for a `base...head` span, the signals the raw diff
 * media type cannot carry (pure renames, binaries, and mode-only changes have
 * no hunks). `per_page: 1` minimizes the commit list riding the same response;
 * `files[]` is NOT paginated, it is capped, hence `complete`.
 */
export async function fetchCompareFiles(
  octokit: Octokit,
  ref: CompareDiffRef,
): Promise<Result<CompareFiles, GitHubApiError>> {
  try {
    const response = await octokit.rest.repos.compareCommitsWithBasehead({
      owner: ref.owner,
      repo: ref.repo,
      basehead: `${ref.base}...${ref.head}`,
      per_page: 1,
    });
    const parsed = compareFilesSchema.safeParse(response.data);
    if (!parsed.success) {
      return {
        ok: false,
        error: unexpectedResponseError("fetch compare files"),
      };
    }
    const spanStatus = parsed.data.status;
    if (parsed.data.files === undefined) {
      // A 200 without `files[]` (degraded/oversized compare) proves nothing,
      // report incomplete so the touched predicate re-looks everything instead
      // of wrongly confirming "untouched".
      return { ok: true, value: shapeCompareFiles([], false, spanStatus) };
    }
    const files = parsed.data.files.map(shapeCompareFile);
    const complete = files.length < COMPARE_FILES_CAP;
    return { ok: true, value: shapeCompareFiles(files, complete, spanStatus) };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "fetch compare files") };
  }
}

/** One compare entry; `previous_filename` rides only on renames and copies. */
function shapeCompareFile(file: {
  filename: string;
  status: string;
  previous_filename?: string | undefined;
}): CompareFile {
  const compareFile: Mutable<CompareFile> = {
    filename: file.filename,
    status: file.status,
  };

  if (file.previous_filename !== undefined) {
    compareFile.previousFilename = file.previous_filename;
  }

  return compareFile;
}

/** The span's file list; `status` is absent when the compare omitted it. */
function shapeCompareFiles(
  files: readonly CompareFile[],
  complete: boolean,
  status: string | undefined,
): CompareFiles {
  const compareFiles: Mutable<CompareFiles> = { files, complete };

  if (status !== undefined) compareFiles.status = status;

  return compareFiles;
}
