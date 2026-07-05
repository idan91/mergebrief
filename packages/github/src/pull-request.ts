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

export interface PullRequestInfo {
  readonly headSha: string;
  readonly baseSha: string;
  /** GitHub PR state (`open` / `closed`). */
  readonly state: string;
  readonly draft: boolean;
  readonly title: string;
}

/** Fetch the minimal PR fields BRIEF-2 needs (head/base SHA, state, draft, title). */
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
      },
    };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "fetch pull request") };
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
