// Pull-request read primitives (BRIEF-2 stage 2): minimal PR metadata and the
// unified diff. The diff uses the `application/vnd.github.diff` media type,
// which returns the raw diff as a string body. Failures are sanitized via
// `mapRequestError`.
import type { Octokit } from "octokit";
import { z } from "zod";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import type { Result } from "../types";

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
  /** Whether the PR has been merged (a merged PR's `state` is `closed`). */
  readonly merged: boolean;
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
        merged: data.merged,
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
    return {
      ok: false,
      error: mapRequestError(error, "list pull request files"),
    };
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
 * List a PR's review comments as RAW wire objects, fully paginated
 * (BRIEF-97). Deliberately unvalidated here: brief-core's
 * `normalizeReviewComment` is the single boundary parser for this shape
 * (outdated-semantics rules, ADR 0007) — declaring a second Zod shape in
 * this package would drift from it. Callers normalize, never trust.
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
 * Count the commits in a `base...head` span (BRIEF-97). `total_commits` is
 * the span total independent of pagination — `per_page: 1` keeps the
 * response minimal since the commit list itself is unused.
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

export interface CommitRef {
  readonly owner: string;
  readonly repo: string;
  /** A commit-ish (possibly abbreviated SHA) to resolve. */
  readonly ref: string;
}

/**
 * Resolve a possibly-abbreviated commit-ish to its full 40-char SHA
 * (BRIEF-97) — artifacts are keyed by full SHAs (exact-equality FE joins).
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

/**
 * One compare `files[]` entry: new-side path + GitHub's per-file status.
 * `status` stays an OPEN string on purpose — consumers must treat unknown
 * values conservatively (touched), so a new GitHub status must degrade, not
 * fail a parse (BRIEF-143).
 */
export interface CompareFile {
  readonly filename: string;
  readonly status: string;
  /** `previous_filename` — present on renamed/copied entries. */
  readonly previousFilename?: string;
}

export interface CompareFiles {
  readonly files: readonly CompareFile[];
  /**
   * False when the list may be truncated: GitHub caps a compare response at
   * 300 files, so a 300-entry list proves nothing about the rest.
   */
  readonly complete: boolean;
}

/** GitHub caps the compare response's `files[]` at this many entries. */
const COMPARE_FILES_CAP = 300;

const compareFilesSchema = z.object({
  files: z
    .array(
      z.object({
        filename: z.string(),
        status: z.string(),
        previous_filename: z.string().optional(),
      }),
    )
    .optional(),
});

/**
 * Fetch the compare endpoint's per-file JSON metadata for a `base...head`
 * span (BRIEF-143): filename, status (added/removed/modified/renamed/…), and
 * `previous_filename` for renames — the signals the raw diff media type
 * cannot carry (pure renames, binaries, and mode-only changes have no
 * hunks). `per_page: 1` minimizes the commit list riding the same response;
 * the `files[]` array is NOT paginated — it is capped, hence `complete`.
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
    if (parsed.data.files === undefined) {
      // A 200 without `files[]` (degraded/oversized compare) proves nothing —
      // report incomplete so the touched predicate re-looks everything
      // instead of wrongly confirming "untouched" (BRIEF-143 conservatism).
      return { ok: true, value: { files: [], complete: false } };
    }
    const files = parsed.data.files.map((file) => ({
      filename: file.filename,
      status: file.status,
      ...(file.previous_filename === undefined
        ? {}
        : { previousFilename: file.previous_filename }),
    }));
    return {
      ok: true,
      value: { files, complete: files.length < COMPARE_FILES_CAP },
    };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "fetch compare files") };
  }
}
