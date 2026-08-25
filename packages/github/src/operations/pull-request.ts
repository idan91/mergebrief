// Pull-request read primitives: PR metadata and the unified diff. The diff
// uses the `application/vnd.github.diff` media type, which returns the raw
// diff as a string body. Failures are sanitized via `mapRequestError`.
import type { Octokit } from "octokit";
import type { RepoId } from "persistence";
import { z } from "zod";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import { repoIdSchema } from "../ids";
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
  /** The base repo's immutable numeric id — the row key the doors upsert by. */
  readonly repoId: RepoId;
  /** The base repo's `owner/name` as GitHub verified it (rename-proof-ish). */
  readonly repoFullName: string;
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
  /** PR author login; null when the account is gone. */
  readonly authorLogin: string | null;
  /** When the PR closed/merged; null while open. */
  readonly closedAt: Date | null;
}

/** One changed file's path + churn, as the generation inputs need it. */
export interface PullRequestFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

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
    return {
      ok: true,
      value: {
        repoId: repoId.data,
        repoFullName: data.base.repo.full_name,
        headSha: data.head.sha,
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
      },
    };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "fetch pull request") };
  }
}

/**
 * List a PR's changed files — the per-file generation input and the whole-PR
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

export interface CommitRef {
  readonly owner: string;
  readonly repo: string;
  /** A commit-ish (possibly abbreviated SHA) to resolve. */
  readonly ref: string;
}

/**
 * Resolve a possibly-abbreviated commit-ish to its full 40-char SHA —
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

/**
 * One compare `files[]` entry. `status` stays an OPEN string on purpose: a new
 * GitHub status must degrade to conservative handling, not fail a parse.
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
  /**
   * The compare relation head-vs-base ('ahead' | 'diverged' | 'behind' |
   * 'identical'; open string). Only 'ahead' means a fast-forward span whose
   * three-dot diff equals the true tree diff — a same-base force-push shows
   * 'diverged' while the base SHA never moves. Absent means not-fast-forward.
   */
  readonly status?: string;
}

/** GitHub caps the compare response's `files[]` at this many entries. */
const COMPARE_FILES_CAP = 300;

const compareFilesSchema = z.object({
  status: z.string().optional(),
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
 * Per-file JSON metadata for a `base...head` span — the signals the raw diff
 * media type cannot carry (pure renames, binaries, and mode-only changes have
 * no hunks). `per_page: 1` minimizes the commit list riding the same response;
 * `files[]` is NOT paginated, it is capped — hence `complete`.
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
    const spanStatus =
      parsed.data.status === undefined ? {} : { status: parsed.data.status };
    if (parsed.data.files === undefined) {
      // A 200 without `files[]` (degraded/oversized compare) proves nothing —
      // report incomplete so the touched predicate re-looks everything instead
      // of wrongly confirming "untouched".
      return { ok: true, value: { files: [], complete: false, ...spanStatus } };
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
      value: {
        files,
        complete: files.length < COMPARE_FILES_CAP,
        ...spanStatus,
      },
    };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "fetch compare files") };
  }
}
