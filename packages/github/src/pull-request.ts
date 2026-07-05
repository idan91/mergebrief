// Pull-request read primitives (BRIEF-2 stage 2): minimal PR metadata and the
// unified diff. The diff uses the `application/vnd.github.diff` media type,
// which returns the raw diff as a string body. Failures are sanitized via
// `mapRequestError`.
import type { Octokit } from "octokit";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "./errors";
import type { Result } from "./types";

export interface PullRequestRef {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
}

export interface CompareDiffRef {
  readonly owner: string;
  readonly repo: string;
  /** The span endpoints — any two refs (SHAs/branches) GitHub can compare. */
  readonly base: string;
  readonly head: string;
}

export interface PullRequestInfo {
  readonly headSha: string;
  readonly baseSha: string;
  /** GitHub PR state (`open` / `closed`). */
  readonly state: string;
  readonly draft: boolean;
  readonly title: string;
  /** PR description body; GitHub sends null for an empty description. */
  readonly body: string;
  /** The PR's html page URL (generation metadata — never fetched from). */
  readonly htmlUrl: string;
  /** Number of commits on the PR at this head. */
  readonly commitCount: number;
}

/** One changed file's path + churn, as the generation inputs need it. */
export interface PullRequestFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

/**
 * Fetch the PR fields the webhook mapping (BRIEF-2) and the worker's
 * generation inputs (BRIEF-3) need: SHAs, state, title/body/url, commit count.
 */
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
    return {
      ok: true,
      value: {
        headSha: data.head.sha,
        baseSha: data.base.sha,
        state: data.state,
        draft: data.draft ?? false,
        title: data.title,
        body: data.body ?? "",
        htmlUrl: data.html_url,
        commitCount: data.commits,
      },
    };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "fetch pull request") };
  }
}

/**
 * List a PR's changed files (path + additions/deletions) via the paginated
 * `pulls.listFiles` endpoint — the worker's per-file generation input and the
 * whole-PR churn denominator for the huge-span heuristic (ADR 0006 #7).
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
    return { ok: false, error: mapRequestError(error, "list pull request files") };
  }
}

/**
 * Fetch a PR's unified diff. Requests the `diff` media type, so GitHub returns
 * the raw diff text as the response body (octokit types it as the PR object, so
 * we narrow the runtime string ourselves).
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
 * Fetch the unified diff for an explicit `base...head` span via the compare
 * endpoint (`GET /repos/{owner}/{repo}/compare/{base}...{head}`) with the diff
 * media type, so the response is exactly the requested range rather than the
 * whole-PR diff. Same string-narrowing and sanitization as `fetchDiff`.
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
      return { ok: false, error: unexpectedResponseError("fetch compare diff") };
    }
    return { ok: true, value: body };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "fetch compare diff") };
  }
}
