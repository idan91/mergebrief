// Comment ops + fetch primitives against a hand-written, injected octokit stub.
// Asserts: success maps to the Result ok-shape; a 404 from deleteComment is
// idempotent ok; a 403/404 from a fetch maps to a sanitized Result error that
// leaks NO token/header/body.
import { RequestError, type Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import {
  deleteComment,
  fetchComment,
  postEntryComment,
} from "../src/operations/comments";
import { GitHubApiErrorCodes } from "../src/errors";
import {
  fetchPullRequest,
  fetchPullRequestFiles,
  fetchDiff,
  fetchCompareDiff,
  fetchCompareFiles,
  fetchCompareCommitCount,
  fetchReviewCommentsRaw,
  resolveCommitSha,
} from "../src/operations/pull-request";
import {
  createPullRequestReview,
  ReviewCommentSides,
  ReviewEvents,
  ReviewValidationClasses,
} from "../src/operations/review";
import {
  fetchRepositoryById,
  listInstallationRepositoriesForUser,
} from "../src/operations/repo";
import { isInstallationId, isRepoId } from "../src/ids";

// A leaked auth header/token must never surface in a sanitized error. We plant
// one in the thrown RequestError's request options and assert it never escapes.
const LEAKED_TOKEN = "ghs_PLANTED_INSTALLATION_TOKEN";

function requestError(
  status: number,
  responseHeaders: Record<string, string> = {},
): RequestError {
  return new RequestError(`HTTP ${status}`, status, {
    request: {
      method: "GET",
      url: "https://api.github.com/repositories/1",
      headers: { authorization: `token ${LEAKED_TOKEN}` },
    },
    response: {
      status,
      url: "https://api.github.com/repositories/1",
      headers: responseHeaders,
      data: { message: "Not Found", token: LEAKED_TOKEN },
    },
  });
}

// The double assertion injects a structural mock where the full `Octokit` type
// is expected; only the methods under test are implemented.
function mockOctokit(overrides: {
  createComment?: ReturnType<typeof vi.fn>;
  deleteComment?: ReturnType<typeof vi.fn>;
  getComment?: ReturnType<typeof vi.fn>;
  pullsGet?: ReturnType<typeof vi.fn>;
  createReview?: ReturnType<typeof vi.fn>;
  compareBasehead?: ReturnType<typeof vi.fn>;
  getCommit?: ReturnType<typeof vi.fn>;
  listReviewComments?: ReturnType<typeof vi.fn>;
  request?: ReturnType<typeof vi.fn>;
  paginate?: ReturnType<typeof vi.fn>;
}): Octokit {
  const stub = {
    request: overrides.request ?? vi.fn(),
    paginate: overrides.paginate ?? vi.fn(),
    rest: {
      issues: {
        createComment: overrides.createComment ?? vi.fn(),
        deleteComment: overrides.deleteComment ?? vi.fn(),
        getComment: overrides.getComment ?? vi.fn(),
      },
      pulls: {
        get: overrides.pullsGet ?? vi.fn(),
        listFiles: vi.fn(),
        createReview: overrides.createReview ?? vi.fn(),
        listReviewComments: overrides.listReviewComments ?? vi.fn(),
      },
      repos: {
        compareCommitsWithBasehead: overrides.compareBasehead ?? vi.fn(),
        getCommit: overrides.getCommit ?? vi.fn(),
      },
    },
  };
  return stub as unknown as Octokit;
}

function toRepoId(value: bigint) {
  if (!isRepoId(value)) throw new Error("expected a positive repo id");
  return value;
}

function toInstallationId(value: bigint) {
  if (!isInstallationId(value))
    throw new Error("expected a positive installation id");
  return value;
}

describe("postEntryComment", () => {
  it("returns the created comment id as a bigint", async () => {
    const createComment = vi.fn().mockResolvedValue({ data: { id: 42 } });
    const octokit = mockOctokit({ createComment });
    const result = await postEntryComment(octokit, {
      owner: "o",
      repo: "r",
      prNumber: 7,
      body: "brief ready",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.commentId).toBe(42n);
    expect(createComment).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      issue_number: 7,
      body: "brief ready",
    });
  });

  it("rejects a comment id past the safe-integer range (rounded by JSON.parse)", async () => {
    const createComment = vi
      .fn()
      .mockResolvedValue({ data: { id: 9007199254740992 } });
    const octokit = mockOctokit({ createComment });
    const result = await postEntryComment(octokit, {
      owner: "o",
      repo: "r",
      prNumber: 7,
      body: "brief ready",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });

  it("maps an API failure to a sanitized error", async () => {
    const createComment = vi.fn().mockRejectedValue(requestError(403));
    const octokit = mockOctokit({ createComment });
    const result = await postEntryComment(octokit, {
      owner: "o",
      repo: "r",
      prNumber: 7,
      body: "x",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
    expect(result.error.status).toBe(403);
    expect(result.error.message).not.toContain(LEAKED_TOKEN);
  });
});

describe("deleteComment", () => {
  it("returns ok on success", async () => {
    const deleteFn = vi.fn().mockResolvedValue({ status: 204 });
    const octokit = mockOctokit({ deleteComment: deleteFn });
    const result = await deleteComment(octokit, {
      owner: "o",
      repo: "r",
      commentId: 99n,
    });
    expect(result.ok).toBe(true);
    expect(deleteFn).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      comment_id: 99,
    });
  });

  it("treats a 404 as idempotent success (already gone)", async () => {
    const deleteFn = vi.fn().mockRejectedValue(requestError(404));
    const octokit = mockOctokit({ deleteComment: deleteFn });
    const result = await deleteComment(octokit, {
      owner: "o",
      repo: "r",
      commentId: 99n,
    });
    expect(result.ok).toBe(true);
  });

  it("maps a non-404 failure to a sanitized error", async () => {
    const deleteFn = vi.fn().mockRejectedValue(requestError(500));
    const octokit = mockOctokit({ deleteComment: deleteFn });
    const result = await deleteComment(octokit, {
      owner: "o",
      repo: "r",
      commentId: 99n,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
    expect(result.error.status).toBe(500);
    expect(result.error.message).not.toContain(LEAKED_TOKEN);
  });
});

describe("fetchComment", () => {
  it("returns the comment body on success", async () => {
    const getComment = vi
      .fn()
      .mockResolvedValue({ data: { id: 99, body: "brief ready" } });
    const octokit = mockOctokit({ getComment });
    const result = await fetchComment(octokit, {
      owner: "o",
      repo: "r",
      commentId: 99n,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ body: "brief ready" });
    expect(getComment).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      comment_id: 99,
    });
  });

  it("maps a 404 (comment gone) to ok undefined", async () => {
    const getComment = vi.fn().mockRejectedValue(requestError(404));
    const octokit = mockOctokit({ getComment });
    const result = await fetchComment(octokit, {
      owner: "o",
      repo: "r",
      commentId: 99n,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toBeUndefined();
  });

  it("maps a non-404 failure to a sanitized error", async () => {
    const getComment = vi.fn().mockRejectedValue(requestError(500));
    const octokit = mockOctokit({ getComment });
    const result = await fetchComment(octokit, {
      owner: "o",
      repo: "r",
      commentId: 99n,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
    expect(result.error.status).toBe(500);
    expect(result.error.message).not.toContain(LEAKED_TOKEN);
  });
});

describe("fetchRepositoryById", () => {
  it("returns the repo info on success", async () => {
    const request = vi.fn().mockResolvedValue({
      data: { id: 1, full_name: "o/r", private: true },
    });
    const octokit = mockOctokit({ request });
    const result = await fetchRepositoryById(octokit, toRepoId(1n));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.fullName).toBe("o/r");
    expect(result.value.private).toBe(true);
    expect(result.value.repoId).toBe(1n);
    expect(request).toHaveBeenCalledWith("GET /repositories/{id}", { id: 1 });
  });

  it("captures permissions.push as viewerCanPush when GitHub returns permissions", async () => {
    // A user-to-server read includes the VIEWER's effective `permissions`
    // block — `push` is the write-capability signal.
    const request = vi.fn().mockResolvedValue({
      data: {
        id: 1,
        full_name: "o/r",
        private: true,
        permissions: { admin: false, push: true, pull: true },
      },
    });
    const octokit = mockOctokit({ request });
    const result = await fetchRepositoryById(octokit, toRepoId(1n));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.viewerCanPush).toBe(true);
  });

  it("viewerCanPush is false when the permissions block is absent (fail closed)", async () => {
    const request = vi.fn().mockResolvedValue({
      data: { id: 1, full_name: "o/r", private: true },
    });
    const octokit = mockOctokit({ request });
    const result = await fetchRepositoryById(octokit, toRepoId(1n));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.viewerCanPush).toBe(false);
  });

  it("a permissions block WITHOUT push degrades to false, never fails the parse", async () => {
    // This fetch is the authz gate's only probe — a capability-signal glitch
    // must not become a full access denial.
    const request = vi.fn().mockResolvedValue({
      data: {
        id: 1,
        full_name: "o/r",
        private: true,
        permissions: { admin: false },
      },
    });
    const octokit = mockOctokit({ request });
    const result = await fetchRepositoryById(octokit, toRepoId(1n));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.viewerCanPush).toBe(false);
  });

  it("viewerCanPush is false when permissions.push is false", async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        id: 1,
        full_name: "o/r",
        private: true,
        permissions: { admin: false, push: false, pull: true },
      },
    });
    const octokit = mockOctokit({ request });
    const result = await fetchRepositoryById(octokit, toRepoId(1n));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.viewerCanPush).toBe(false);
  });

  it("maps a 404 to a sanitized not-found error with no leaked token", async () => {
    const request = vi.fn().mockRejectedValue(requestError(404));
    const octokit = mockOctokit({ request });
    const result = await fetchRepositoryById(octokit, toRepoId(1n));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(result.error.status).toBe(404);
    const serialized = JSON.stringify(result.error);
    expect(serialized).not.toContain(LEAKED_TOKEN);
    expect(serialized).not.toContain("authorization");
  });

  it("maps an unexpected 2xx body to a request-failed error", async () => {
    const request = vi.fn().mockResolvedValue({ data: { id: 1 } });
    const octokit = mockOctokit({ request });
    const result = await fetchRepositoryById(octokit, toRepoId(1n));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });
});

describe("listInstallationRepositoriesForUser", () => {
  const INSTALLATION = toInstallationId(987654n);

  it("returns the FULL paginated repo-id → verified-name map (exhausts pages)", async () => {
    // `octokit.paginate` follows Link headers to exhaustion and returns the
    // flattened item array — the mock returns what an >100-repo installation
    // would produce across two pages.
    const paginate = vi.fn().mockResolvedValue([
      { id: 101, full_name: "octo/alpha" },
      { id: 202, full_name: "octo/beta" },
      { id: 303, full_name: "octo/page-two" },
    ]);
    const octokit = mockOctokit({ paginate });
    const result = await listInstallationRepositoriesForUser(
      octokit,
      INSTALLATION,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.size).toBe(3);
    expect(result.value.get(toRepoId(101n))).toBe("octo/alpha");
    expect(result.value.get(toRepoId(303n))).toBe("octo/page-two");
    expect(paginate).toHaveBeenCalledTimes(1);
    const [route, params] = paginate.mock.calls[0] ?? [];
    expect(String(route)).toContain(
      "/user/installations/{installation_id}/repositories",
    );
    expect(params).toMatchObject({ installation_id: 987654, per_page: 100 });
  });

  it("maps a 401 to a sanitized unauthorized error (refresh trigger)", async () => {
    const paginate = vi.fn().mockRejectedValue(requestError(401));
    const octokit = mockOctokit({ paginate });
    const result = await listInstallationRepositoriesForUser(
      octokit,
      INSTALLATION,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.UNAUTHORIZED);
    expect(JSON.stringify(result.error)).not.toContain(LEAKED_TOKEN);
  });

  it("maps an unexpected 2xx body to a request-failed error", async () => {
    const paginate = vi.fn().mockResolvedValue([{ nope: true }]);
    const octokit = mockOctokit({ paginate });
    const result = await listInstallationRepositoriesForUser(
      octokit,
      INSTALLATION,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });

  it("rejects a repo id past the safe-integer range", async () => {
    const paginate = vi
      .fn()
      .mockResolvedValue([
        { id: Number.MAX_SAFE_INTEGER + 2, full_name: "octo/huge" },
      ]);
    const octokit = mockOctokit({ paginate });
    const result = await listInstallationRepositoriesForUser(
      octokit,
      INSTALLATION,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });
});

describe("mapRequestError — rate-limit classification", () => {
  it("classifies a 403 with an exhausted primary limit as rate-limited", async () => {
    const request = vi
      .fn()
      .mockRejectedValue(requestError(403, { "x-ratelimit-remaining": "0" }));
    const octokit = mockOctokit({ request });
    const result = await fetchRepositoryById(octokit, toRepoId(1n));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.RATE_LIMITED);
    expect(result.error.status).toBe(403);
    expect(JSON.stringify(result.error)).not.toContain(LEAKED_TOKEN);
  });

  it("classifies a 403 carrying retry-after (secondary limit) as rate-limited", async () => {
    const request = vi
      .fn()
      .mockRejectedValue(requestError(403, { "retry-after": "60" }));
    const octokit = mockOctokit({ request });
    const result = await fetchRepositoryById(octokit, toRepoId(1n));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.RATE_LIMITED);
  });

  it("keeps a plain 403 (with remaining budget) as forbidden", async () => {
    const request = vi
      .fn()
      .mockRejectedValue(requestError(403, { "x-ratelimit-remaining": "42" }));
    const octokit = mockOctokit({ request });
    const result = await fetchRepositoryById(octokit, toRepoId(1n));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
  });
});

describe("fetchPullRequest / fetchDiff", () => {
  it("extracts the minimal PR fields", async () => {
    const pullsGet = vi.fn().mockResolvedValue({
      data: {
        head: { sha: "head-sha" },
        base: { sha: "base-sha", repo: { id: 424242, full_name: "o/r" } },
        state: "open",
        draft: false,
        merged: false,
        title: "A PR",
        body: "does a thing",
        html_url: "https://github.com/o/r/pull/3",
        commits: 4,
        user: { login: "octocat" },
        closed_at: null,
      },
    });
    const octokit = mockOctokit({ pullsGet });
    const result = await fetchPullRequest(octokit, {
      owner: "o",
      repo: "r",
      prNumber: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({
      repoId: 424242n,
      repoFullName: "o/r",
      headSha: "head-sha",
      baseSha: "base-sha",
      state: "open",
      draft: false,
      merged: false,
      title: "A PR",
      body: "does a thing",
      htmlUrl: "https://github.com/o/r/pull/3",
      commitCount: 4,
      authorLogin: "octocat",
      closedAt: null,
    });
  });

  it("captures merged on a merged (closed) PR", async () => {
    const pullsGet = vi.fn().mockResolvedValue({
      data: {
        head: { sha: "head-sha" },
        base: { sha: "base-sha", repo: { id: 424242, full_name: "o/r" } },
        state: "closed",
        draft: false,
        merged: true,
        title: "A merged PR",
        body: "",
        html_url: "https://github.com/o/r/pull/4",
        commits: 2,
        user: { login: "octocat" },
        closed_at: "2026-08-01T00:00:00Z",
      },
    });
    const octokit = mockOctokit({ pullsGet });
    const result = await fetchPullRequest(octokit, {
      owner: "o",
      repo: "r",
      prNumber: 4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.state).toBe("closed");
    expect(result.value.merged).toBe(true);
  });

  it("normalizes a null PR body to the empty string", async () => {
    const pullsGet = vi.fn().mockResolvedValue({
      data: {
        head: { sha: "head-sha" },
        base: { sha: "base-sha", repo: { id: 424242, full_name: "o/r" } },
        state: "open",
        draft: false,
        merged: false,
        title: "A PR",
        body: null,
        html_url: "https://github.com/o/r/pull/3",
        commits: 1,
        user: { login: "octocat" },
        closed_at: null,
      },
    });
    const octokit = mockOctokit({ pullsGet });
    const result = await fetchPullRequest(octokit, {
      owner: "o",
      repo: "r",
      prNumber: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.body).toBe("");
  });

  it("lists changed files via pagination, mapping path + churn", async () => {
    const paginate = vi.fn().mockResolvedValue([
      { filename: "src/a.ts", additions: 3, deletions: 1, status: "modified" },
      { filename: "src/b.ts", additions: 10, deletions: 0, status: "added" },
    ]);
    const octokit = mockOctokit({ paginate });
    const result = await fetchPullRequestFiles(octokit, {
      owner: "o",
      repo: "r",
      prNumber: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual([
      { path: "src/a.ts", additions: 3, deletions: 1 },
      { path: "src/b.ts", additions: 10, deletions: 0 },
    ]);
    expect(paginate).toHaveBeenCalledWith(
      octokit.rest.pulls.listFiles,
      expect.objectContaining({
        owner: "o",
        repo: "r",
        pull_number: 3,
        per_page: 100,
      }),
    );
  });

  it("sanitizes a listFiles failure", async () => {
    const paginate = vi.fn().mockRejectedValue(requestError(404));
    const octokit = mockOctokit({ paginate });
    const result = await fetchPullRequestFiles(octokit, {
      owner: "o",
      repo: "r",
      prNumber: 3,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
  });

  it("returns the raw diff string", async () => {
    const diff = "diff --git a/f b/f\n@@ -1 +1 @@\n-a\n+b\n";
    const pullsGet = vi.fn().mockResolvedValue({ data: diff });
    const octokit = mockOctokit({ pullsGet });
    const result = await fetchDiff(octokit, {
      owner: "o",
      repo: "r",
      prNumber: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toBe(diff);
    expect(pullsGet).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      pull_number: 3,
      mediaType: { format: "diff" },
    });
  });

  it("fetches the compare diff for an explicit base...head span", async () => {
    const diff = "diff --git a/f b/f\n@@ -1 +1 @@\n-a\n+b\n";
    const compareBasehead = vi.fn().mockResolvedValue({ data: diff });
    const octokit = mockOctokit({ compareBasehead });
    const result = await fetchCompareDiff(octokit, {
      owner: "o",
      repo: "r",
      base: "base-sha",
      head: "head-sha",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toBe(diff);
    expect(compareBasehead).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      basehead: "base-sha...head-sha",
      mediaType: { format: "diff" },
    });
  });

  it("maps a compare diff failure to a sanitized error", async () => {
    const compareBasehead = vi.fn().mockRejectedValue(requestError(404));
    const octokit = mockOctokit({ compareBasehead });
    const result = await fetchCompareDiff(octokit, {
      owner: "o",
      repo: "r",
      base: "b",
      head: "h",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(result.error.message).not.toContain(LEAKED_TOKEN);
  });

  it("maps a diff fetch failure to a sanitized error", async () => {
    const pullsGet = vi.fn().mockRejectedValue(requestError(404));
    const octokit = mockOctokit({ pullsGet });
    const result = await fetchDiff(octokit, {
      owner: "o",
      repo: "r",
      prNumber: 3,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(result.error.message).not.toContain(LEAKED_TOKEN);
  });
});

describe("fetchCompareFiles", () => {
  it("returns per-file status entries with previous_filename mapped through", async () => {
    const compareBasehead = vi.fn().mockResolvedValue({
      data: {
        files: [
          { filename: "src/a.ts", status: "modified" },
          {
            filename: "src/b2.ts",
            status: "renamed",
            previous_filename: "src/b.ts",
          },
        ],
      },
    });
    const octokit = mockOctokit({ compareBasehead });
    const result = await fetchCompareFiles(octokit, {
      owner: "o",
      repo: "r",
      base: "base-sha",
      head: "head-sha",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.files).toEqual([
      { filename: "src/a.ts", status: "modified" },
      {
        filename: "src/b2.ts",
        status: "renamed",
        previousFilename: "src/b.ts",
      },
    ]);
    expect(result.value.complete).toBe(true);
    expect(compareBasehead).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      basehead: "base-sha...head-sha",
      per_page: 1,
    });
  });

  it("maps the compare span status through (fast-forward detection)", async () => {
    const compareBasehead = vi.fn().mockResolvedValue({
      data: {
        status: "diverged",
        files: [{ filename: "src/a.ts", status: "modified" }],
      },
    });
    const octokit = mockOctokit({ compareBasehead });
    const result = await fetchCompareFiles(octokit, {
      owner: "o",
      repo: "r",
      base: "b",
      head: "h",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.status).toBe("diverged");
  });

  it("flags a possibly-truncated list (300-file compare cap) as incomplete", async () => {
    const files = Array.from({ length: 300 }, (_, i) => ({
      filename: `f${i}.ts`,
      status: "modified",
    }));
    const compareBasehead = vi.fn().mockResolvedValue({ data: { files } });
    const octokit = mockOctokit({ compareBasehead });
    const result = await fetchCompareFiles(octokit, {
      owner: "o",
      repo: "r",
      base: "b",
      head: "h",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.complete).toBe(false);
    expect(result.value.files).toHaveLength(300);
  });

  it("treats a missing files array as INCOMPLETE — absence proves nothing", async () => {
    const compareBasehead = vi.fn().mockResolvedValue({ data: {} });
    const octokit = mockOctokit({ compareBasehead });
    const result = await fetchCompareFiles(octokit, {
      owner: "o",
      repo: "r",
      base: "b",
      head: "h",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ files: [], complete: false });
  });

  it("maps a compare files failure to a sanitized error", async () => {
    const compareBasehead = vi.fn().mockRejectedValue(requestError(404));
    const octokit = mockOctokit({ compareBasehead });
    const result = await fetchCompareFiles(octokit, {
      owner: "o",
      repo: "r",
      base: "b",
      head: "h",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(result.error.message).not.toContain(LEAKED_TOKEN);
  });

  it("rejects a malformed files payload with an unexpected-response error", async () => {
    const compareBasehead = vi.fn().mockResolvedValue({
      data: { files: [{ status: "modified" }] },
    });
    const octokit = mockOctokit({ compareBasehead });
    const result = await fetchCompareFiles(octokit, {
      owner: "o",
      repo: "r",
      base: "b",
      head: "h",
    });
    expect(result.ok).toBe(false);
  });
});

describe("fetchReviewCommentsRaw / fetchCompareCommitCount / resolveCommitSha", () => {
  it("pages through review comments and returns the raw wire objects", async () => {
    const wire = [
      { id: 1, body: "b1" },
      { id: 2, body: "b2" },
    ];
    const paginate = vi.fn().mockResolvedValue(wire);
    const listReviewComments = vi.fn();
    const octokit = mockOctokit({ paginate, listReviewComments });
    const result = await fetchReviewCommentsRaw(octokit, {
      owner: "o",
      repo: "r",
      prNumber: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual(wire);
    expect(paginate).toHaveBeenCalledWith(listReviewComments, {
      owner: "o",
      repo: "r",
      pull_number: 3,
      per_page: 100,
    });
  });

  it("maps a review-comments failure to a sanitized error", async () => {
    const paginate = vi.fn().mockRejectedValue(requestError(403));
    const octokit = mockOctokit({ paginate });
    const result = await fetchReviewCommentsRaw(octokit, {
      owner: "o",
      repo: "r",
      prNumber: 3,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
    expect(result.error.message).not.toContain(LEAKED_TOKEN);
  });

  it("returns total_commits for a compare span", async () => {
    const compareBasehead = vi
      .fn()
      .mockResolvedValue({ data: { total_commits: 5 } });
    const octokit = mockOctokit({ compareBasehead });
    const result = await fetchCompareCommitCount(octokit, {
      owner: "o",
      repo: "r",
      base: "b1",
      head: "h1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toBe(5);
    expect(compareBasehead).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      basehead: "b1...h1",
      per_page: 1,
    });
  });

  it("maps a compare-count failure to a sanitized error", async () => {
    const compareBasehead = vi.fn().mockRejectedValue(requestError(404));
    const octokit = mockOctokit({ compareBasehead });
    const result = await fetchCompareCommitCount(octokit, {
      owner: "o",
      repo: "r",
      base: "b1",
      head: "h1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(result.error.message).not.toContain(LEAKED_TOKEN);
  });

  it("resolves a commit-ish to the full sha", async () => {
    const getCommit = vi
      .fn()
      .mockResolvedValue({ data: { sha: "f".repeat(40) } });
    const octokit = mockOctokit({ getCommit });
    const result = await resolveCommitSha(octokit, {
      owner: "o",
      repo: "r",
      ref: "abc1234",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toBe("f".repeat(40));
    expect(getCommit).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      ref: "abc1234",
    });
  });

  it("maps a commit-resolve failure to a sanitized error", async () => {
    const getCommit = vi.fn().mockRejectedValue(requestError(404));
    const octokit = mockOctokit({ getCommit });
    const result = await resolveCommitSha(octokit, {
      owner: "o",
      repo: "r",
      ref: "abc1234",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(result.error.message).not.toContain(LEAKED_TOKEN);
  });
});

// A 422 as GitHub's create-review endpoint actually shapes it: top-level
// "Validation Failed" + an `errors` array of strings and/or objects. The body
// (like every response body) must never surface in the sanitized Result.
function validation422(errors: unknown): RequestError {
  return new RequestError("Validation Failed", 422, {
    request: {
      method: "POST",
      url: "https://api.github.com/repos/o/r/pulls/7/reviews",
      headers: { authorization: `token ${LEAKED_TOKEN}` },
    },
    response: {
      status: 422,
      url: "https://api.github.com/repos/o/r/pulls/7/reviews",
      headers: {},
      data: { message: "Validation Failed", errors, token: LEAKED_TOKEN },
    },
  });
}

describe("createPullRequestReview", () => {
  const baseInput = {
    owner: "o",
    repo: "r",
    prNumber: 7,
    commitId: "c".repeat(40),
    event: ReviewEvents.REQUEST_CHANGES,
    body: "overall verdict",
    comments: [
      {
        path: "src/a.ts",
        line: 12,
        side: ReviewCommentSides.RIGHT,
        body: "anchored note",
      },
      {
        path: "src/b.ts",
        line: 30,
        side: ReviewCommentSides.LEFT,
        startLine: 25,
        startSide: ReviewCommentSides.LEFT,
        body: "multi-line note",
      },
    ],
  };

  it("posts one grouped formal review pinned to commit_id and returns its id", async () => {
    const createReview = vi.fn().mockResolvedValue({ data: { id: 512 } });
    const octokit = mockOctokit({ createReview });
    const result = await createPullRequestReview(octokit, baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.reviewId).toBe(512n);
    expect(createReview).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      pull_number: 7,
      commit_id: "c".repeat(40),
      event: "REQUEST_CHANGES",
      body: "overall verdict",
      comments: [
        { path: "src/a.ts", line: 12, side: "RIGHT", body: "anchored note" },
        {
          path: "src/b.ts",
          line: 30,
          side: "LEFT",
          start_line: 25,
          start_side: "LEFT",
          body: "multi-line note",
        },
      ],
    });
    // A single-line comment must not carry start_line/start_side keys at all —
    // GitHub 422s a start_line equal to or past line.
    const sent = createReview.mock.calls[0]?.[0]?.comments?.[0];
    if (sent === undefined) throw new Error("expected a sent comment");
    expect("start_line" in sent).toBe(false);
    expect("start_side" in sent).toBe(false);
  });

  it("omits body and comments entirely when absent (bare APPROVE)", async () => {
    const createReview = vi.fn().mockResolvedValue({ data: { id: 513 } });
    const octokit = mockOctokit({ createReview });
    const result = await createPullRequestReview(octokit, {
      owner: "o",
      repo: "r",
      prNumber: 7,
      commitId: "c".repeat(40),
      event: ReviewEvents.APPROVE,
    });
    expect(result.ok).toBe(true);
    const sent = createReview.mock.calls[0]?.[0];
    if (sent === undefined) throw new Error("expected a createReview call");
    expect("body" in sent).toBe(false);
    expect("comments" in sent).toBe(false);
  });

  it("rejects a review id past the safe-integer range", async () => {
    const createReview = vi
      .fn()
      .mockResolvedValue({ data: { id: 9007199254740992 } });
    const octokit = mockOctokit({ createReview });
    const result = await createPullRequestReview(octokit, baseInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });

  it("classifies a commit_id 422 as unknown-commit without leaking the body", async () => {
    const createReview = vi.fn().mockRejectedValue(
      validation422([
        {
          resource: "PullRequestReview",
          code: "invalid",
          field: "commit_id",
        },
      ]),
    );
    const octokit = mockOctokit({ createReview });
    const result = await createPullRequestReview(octokit, baseInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.status).toBe(422);
    expect(result.error.validation).toBe(
      ReviewValidationClasses.UNKNOWN_COMMIT,
    );
    const serialized = JSON.stringify(result.error);
    expect(serialized).not.toContain(LEAKED_TOKEN);
    expect(serialized).not.toContain("Validation Failed");
    expect(serialized).not.toContain("commit_id");
  });

  it("classifies an anchoring 422 (string errors) as invalid-comments", async () => {
    const createReview = vi
      .fn()
      .mockRejectedValue(
        validation422([
          "Pull request review thread line must be part of the diff",
        ]),
      );
    const octokit = mockOctokit({ createReview });
    const result = await createPullRequestReview(octokit, baseInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.validation).toBe(
      ReviewValidationClasses.INVALID_COMMENTS,
    );
    expect(JSON.stringify(result.error)).not.toContain("thread line");
  });

  it("classifies a 422 whose only signal is the top-level message (empty errors)", async () => {
    // GitHub sometimes reports an unknown SHA solely in the top-level message,
    // e.g. { message: "No commit found for SHA: deadbeef", errors: [] }.
    const createReview = vi.fn().mockRejectedValue(
      new RequestError("Validation Failed", 422, {
        request: {
          method: "POST",
          url: "https://api.github.com/repos/o/r/pulls/7/reviews",
          headers: { authorization: `token ${LEAKED_TOKEN}` },
        },
        response: {
          status: 422,
          url: "https://api.github.com/repos/o/r/pulls/7/reviews",
          headers: {},
          data: { message: "No commit found for SHA: deadbeef", errors: [] },
        },
      }),
    );
    const octokit = mockOctokit({ createReview });
    const result = await createPullRequestReview(octokit, baseInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.validation).toBe(
      ReviewValidationClasses.UNKNOWN_COMMIT,
    );
    expect(JSON.stringify(result.error)).not.toContain("deadbeef");
  });

  it("classifies an unrecognizable 422 body as unknown", async () => {
    const createReview = vi.fn().mockRejectedValue(validation422(undefined));
    const octokit = mockOctokit({ createReview });
    const result = await createPullRequestReview(octokit, baseInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.validation).toBe(ReviewValidationClasses.UNKNOWN);
  });

  it("maps a non-422 failure through the shared taxonomy with no validation class", async () => {
    const createReview = vi.fn().mockRejectedValue(requestError(403));
    const octokit = mockOctokit({ createReview });
    const result = await createPullRequestReview(octokit, baseInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
    expect(result.error.validation).toBeUndefined();
    expect(result.error.message).not.toContain(LEAKED_TOKEN);
  });
});
