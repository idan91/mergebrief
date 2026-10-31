// Comment ops + fetch primitives against a hand-written, injected octokit stub.
// Asserts: success maps to the Result ok-shape; a 404 from deleteComment is
// idempotent ok; a 403/404 from a fetch maps to a sanitized Result error that
// leaks NO token/header/body.
import { RequestError, type Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import {
  deleteComment,
  fetchComment,
  listIssueComments,
  postEntryComment,
} from "../src/operations/comments";
import { GitHubApiErrorCodes } from "../src/errors";
import { fetchIssue } from "../src/operations/issue";
import {
  fetchPullRequest,
  fetchPullRequestFiles,
  fetchDiff,
  fetchCompareDiff,
  fetchCompareFiles,
  fetchCompareCommitCount,
  fetchReviewCommentsRaw,
  listOpenPullRequests,
  resolveCommitSha,
} from "../src/operations/pull-request";
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
  message = `HTTP ${status}`,
): RequestError {
  return new RequestError(message, status, {
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
  issuesGet?: ReturnType<typeof vi.fn>;
  pullsGet?: ReturnType<typeof vi.fn>;
  pullsList?: ReturnType<typeof vi.fn>;
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
        get: overrides.issuesGet ?? vi.fn(),
      },
      pulls: {
        get: overrides.pullsGet ?? vi.fn(),
        list: overrides.pullsList ?? vi.fn(),
        listFiles: vi.fn(),
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
  if (!isRepoId(value)) {
    throw new Error("expected a positive repo id");
  }
  return value;
}

function toInstallationId(value: bigint) {
  if (!isInstallationId(value)) {
    throw new Error("expected a positive installation id");
  }
  return value;
}

describe("listIssueComments", () => {
  const PR = { owner: "acme", repo: "widgets", prNumber: 7 };

  it("leaves a deleted author's comment without an author id", async () => {
    const paginate = vi.fn().mockResolvedValue([
      { id: 5, body: "kept", user: { id: 9 } },
      { id: 6, body: null, user: null },
    ]);

    const listed = await listIssueComments(mockOctokit({ paginate }), PR);

    expect(listed).toEqual({
      ok: true,
      value: [
        { commentId: 5n, authorId: 9n, body: "kept" },
        { commentId: 6n, body: "" },
      ],
    });
  });

  it("fails the whole read on an id past the safe integer range", async () => {
    const paginate = vi
      .fn()
      .mockResolvedValue([
        { id: Number.MAX_SAFE_INTEGER + 2, body: "x", user: { id: 9 } },
      ]);

    const listed = await listIssueComments(mockOctokit({ paginate }), PR);

    expect(listed.ok).toBe(false);
  });
});

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
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.commentId).toBe(42n);
    expect(createComment).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      issue_number: 7,
      body: "brief ready",
    });
  });

  it("rejects a comment id past the safe-integer range", async () => {
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
    if (result.ok) {
      throw new Error("unreachable");
    }
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
    if (result.ok) {
      throw new Error("unreachable");
    }
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

  it("maps a non-404 failure to a sanitized error", async () => {
    const deleteFn = vi.fn().mockRejectedValue(requestError(500));
    const octokit = mockOctokit({ deleteComment: deleteFn });
    const result = await deleteComment(octokit, {
      owner: "o",
      repo: "r",
      commentId: 99n,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
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
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value).toEqual({ body: "brief ready" });
    expect(getComment).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      comment_id: 99,
    });
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
    if (result.ok) {
      throw new Error("unreachable");
    }
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
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.fullName).toBe("o/r");
    expect(result.value.private).toBe(true);
    expect(result.value.repoId).toBe(1n);
    expect(request).toHaveBeenCalledWith("GET /repositories/{id}", { id: 1 });
  });

  it("fails closed to viewerCanPush false without a permissions block", async () => {
    const request = vi.fn().mockResolvedValue({
      data: { id: 1, full_name: "o/r", private: true },
    });
    const octokit = mockOctokit({ request });
    const result = await fetchRepositoryById(octokit, toRepoId(1n));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.viewerCanPush).toBe(false);
  });

  it("degrades a permissions block without push to false, never a failure", async () => {
    // This fetch is the authz gate's only probe, so a capability-signal glitch
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
    if (!result.ok) {
      throw new Error("unreachable");
    }
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
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.viewerCanPush).toBe(false);
  });

  it("captures permissions.admin as viewerIsAdmin", async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        id: 1,
        full_name: "o/r",
        private: true,
        permissions: { admin: true, push: true, pull: true },
      },
    });
    const octokit = mockOctokit({ request });
    const result = await fetchRepositoryById(octokit, toRepoId(1n));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.viewerIsAdmin).toBe(true);
  });

  it("fails closed to viewerIsAdmin false without a permissions block", async () => {
    const request = vi.fn().mockResolvedValue({
      data: { id: 1, full_name: "o/r", private: true },
    });
    const octokit = mockOctokit({ request });
    const result = await fetchRepositoryById(octokit, toRepoId(1n));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.viewerIsAdmin).toBe(false);
  });

  it("viewerIsAdmin is false when the block carries push but no admin", async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        id: 1,
        full_name: "o/r",
        private: true,
        permissions: { push: true },
      },
    });
    const octokit = mockOctokit({ request });
    const result = await fetchRepositoryById(octokit, toRepoId(1n));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.viewerIsAdmin).toBe(false);
  });

  it("maps a 404 to a sanitized not-found error with no leaked token", async () => {
    const request = vi.fn().mockRejectedValue(requestError(404));
    const octokit = mockOctokit({ request });
    const result = await fetchRepositoryById(octokit, toRepoId(1n));
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
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
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });
});

describe("listInstallationRepositoriesForUser", () => {
  const INSTALLATION = toInstallationId(987654n);

  it("returns the full paginated repo-id to verified-name map", async () => {
    // `octokit.paginate` follows Link headers to exhaustion and returns the
    // flattened item array; the mock returns what an >100-repo installation
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
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.size).toBe(3);
    expect(result.value.get(toRepoId(101n))).toEqual({
      fullName: "octo/alpha",
      viewerIsAdmin: false,
    });
    expect(result.value.get(toRepoId(303n))?.fullName).toBe("octo/page-two");
    expect(paginate).toHaveBeenCalledTimes(1);
    const [route, params] = paginate.mock.calls[0] ?? [];
    expect(String(route)).toContain(
      "/user/installations/{installation_id}/repositories",
    );
    expect(params).toMatchObject({ installation_id: 987654, per_page: 100 });
  });

  it("marks a listed repo admin only when its permissions block says so", async () => {
    const paginate = vi.fn().mockResolvedValue([
      {
        id: 101,
        full_name: "octo/alpha",
        permissions: { admin: true, push: true, pull: true },
      },
      {
        id: 202,
        full_name: "octo/beta",
        permissions: { admin: false, push: true, pull: true },
      },
      { id: 303, full_name: "octo/gamma" },
    ]);
    const octokit = mockOctokit({ paginate });
    const result = await listInstallationRepositoriesForUser(
      octokit,
      INSTALLATION,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.get(toRepoId(101n))?.viewerIsAdmin).toBe(true);
    expect(result.value.get(toRepoId(202n))?.viewerIsAdmin).toBe(false);
    expect(result.value.get(toRepoId(303n))?.viewerIsAdmin).toBe(false);
  });

  it("maps a 401 to a sanitized unauthorized error, the refresh trigger", async () => {
    const paginate = vi.fn().mockRejectedValue(requestError(401));
    const octokit = mockOctokit({ paginate });
    const result = await listInstallationRepositoriesForUser(
      octokit,
      INSTALLATION,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
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
    if (result.ok) {
      throw new Error("unreachable");
    }
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
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });
});

describe("mapRequestError rate-limit classification", () => {
  it("classifies a 403 with an exhausted primary limit as rate-limited", async () => {
    const request = vi
      .fn()
      .mockRejectedValue(requestError(403, { "x-ratelimit-remaining": "0" }));
    const octokit = mockOctokit({ request });
    const result = await fetchRepositoryById(octokit, toRepoId(1n));
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.RATE_LIMITED);
    expect(result.error.status).toBe(403);
    expect(JSON.stringify(result.error)).not.toContain(LEAKED_TOKEN);
  });

  it("classifies a secondary-limit 403 carrying retry-after as rate-limited", async () => {
    const request = vi
      .fn()
      .mockRejectedValue(requestError(403, { "retry-after": "60" }));
    const octokit = mockOctokit({ request });
    const result = await fetchRepositoryById(octokit, toRepoId(1n));
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.RATE_LIMITED);
  });

  it("classifies a 403 naming a secondary limit as rate-limited", async () => {
    const secondary = requestError(
      403,
      { "x-ratelimit-remaining": "42" },
      "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
    );
    const request = vi.fn().mockRejectedValue(secondary);
    const octokit = mockOctokit({ request });
    const result = await fetchRepositoryById(octokit, toRepoId(1n));
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.RATE_LIMITED);
    expect(result.error.message).not.toContain("secondary");
  });

  it("keeps a plain 403 with remaining budget as forbidden", async () => {
    const request = vi
      .fn()
      .mockRejectedValue(requestError(403, { "x-ratelimit-remaining": "42" }));
    const octokit = mockOctokit({ request });
    const result = await fetchRepositoryById(octokit, toRepoId(1n));
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
  });
});

describe("fetchPullRequest / fetchDiff", () => {
  it("extracts the minimal PR fields", async () => {
    const pullsGet = vi.fn().mockResolvedValue({
      data: {
        head: {
          sha: "head-sha",
          ref: "feature/thing",
          repo: { name: "fork", owner: { login: "contributor" } },
        },
        base: {
          sha: "base-sha",
          ref: "main",
          repo: {
            id: 424242,
            full_name: "o/r",
            name: "r",
            owner: { login: "o" },
          },
        },
        state: "open",
        draft: false,
        merged: false,
        title: "A PR",
        body: "does a thing",
        html_url: "https://github.com/o/r/pull/3",
        commits: 4,
        changed_files: 12,
        user: { login: "octocat" },
        closed_at: null,
        updated_at: "2026-09-20T10:00:00Z",
      },
    });
    const octokit = mockOctokit({ pullsGet });
    const result = await fetchPullRequest(octokit, {
      owner: "o",
      repo: "r",
      prNumber: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value).toEqual({
      repoId: 424242n,
      repoFullName: "o/r",
      headSha: "head-sha",
      headRef: "feature/thing",
      baseRef: "main",
      baseSha: "base-sha",
      state: "open",
      draft: false,
      merged: false,
      title: "A PR",
      body: "does a thing",
      htmlUrl: "https://github.com/o/r/pull/3",
      commitCount: 4,
      changedFiles: 12,
      authorLogin: "octocat",
      authorIsBot: false,
      closedAt: null,
      updatedAt: new Date("2026-09-20T10:00:00Z"),
      headRepo: { owner: "contributor", repo: "fork" },
      baseRepo: { owner: "o", repo: "r" },
    });
  });

  it.each([undefined, ""])(
    "omits baseRef when GitHub sends no usable base.ref",
    async (baseRef) => {
      const pullsGet = vi.fn().mockResolvedValue({
        data: {
          head: { sha: "head-sha", ref: "feature/thing" },
          base: {
            sha: "base-sha",
            ref: baseRef,
            repo: { id: 424242, full_name: "o/r" },
          },
          state: "open",
          draft: false,
          merged: false,
          title: "A PR",
          body: "does a thing",
          html_url: "https://github.com/o/r/pull/3",
          commits: 4,
          user: { login: "octocat" },
          closed_at: null,
          updated_at: "2026-09-20T10:00:00Z",
        },
      });
      const octokit = mockOctokit({ pullsGet });
      const result = await fetchPullRequest(octokit, {
        owner: "o",
        repo: "r",
        prNumber: 3,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("unreachable");
      }
      expect("baseRef" in result.value).toBe(false);
    },
  );

  it.each([
    ["a Bot", true, { login: "renovate[bot]", type: "Bot" }],
    ["a User", false, { login: "octocat", type: "User" }],
    ["no", false, null],
  ])("reads %s author as authorIsBot %s", async (_label, expected, user) => {
    const pullsGet = vi.fn().mockResolvedValue({
      data: {
        head: { sha: "head-sha", ref: "feature/thing" },
        base: { sha: "base-sha", repo: { id: 424242, full_name: "o/r" } },
        state: "open",
        draft: false,
        merged: false,
        title: "A PR",
        body: "",
        html_url: "https://github.com/o/r/pull/3",
        commits: 1,
        user,
        closed_at: null,
        updated_at: "2026-09-20T10:00:00Z",
      },
    });
    const octokit = mockOctokit({ pullsGet });
    const result = await fetchPullRequest(octokit, {
      owner: "o",
      repo: "r",
      prNumber: 3,
    });
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.authorIsBot).toBe(expected);
  });

  it("captures merged on a merged and closed PR", async () => {
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
        updated_at: "2026-09-20T10:00:00Z",
      },
    });
    const octokit = mockOctokit({ pullsGet });
    const result = await fetchPullRequest(octokit, {
      owner: "o",
      repo: "r",
      prNumber: 4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.state).toBe("closed");
    expect(result.value.merged).toBe(true);
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
    if (!result.ok) {
      throw new Error("unreachable");
    }
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
});

describe("listOpenPullRequests", () => {
  it("maps number, title, draft, branch refs and repository identity", async () => {
    const paginate = vi.fn().mockResolvedValue([
      {
        number: 12,
        title: "Bottom of the stack",
        draft: true,
        head: {
          ref: "feature/a",
          repo: { name: "r", owner: { login: "o" } },
        },
        base: {
          ref: "main",
          repo: { name: "r", owner: { login: "o" } },
        },
      },
      {
        number: 13,
        title: "Middle",
        head: {
          ref: "feature/b",
          repo: { name: "r", owner: { login: "o" } },
        },
        base: {
          ref: "feature/a",
          repo: { name: "r", owner: { login: "o" } },
        },
      },
    ]);
    const octokit = mockOctokit({ paginate });
    const result = await listOpenPullRequests(octokit, {
      owner: "o",
      repo: "r",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value).toEqual([
      {
        number: 12,
        title: "Bottom of the stack",
        draft: true,
        headRef: "feature/a",
        baseRef: "main",
        headRepo: { owner: "o", repo: "r" },
        baseRepo: { owner: "o", repo: "r" },
      },
      {
        number: 13,
        title: "Middle",
        draft: false,
        headRef: "feature/b",
        baseRef: "feature/a",
        headRepo: { owner: "o", repo: "r" },
        baseRepo: { owner: "o", repo: "r" },
      },
    ]);
    expect(paginate).toHaveBeenCalledWith(
      octokit.rest.pulls.list,
      expect.objectContaining({
        owner: "o",
        repo: "r",
        state: "open",
        per_page: 100,
      }),
    );
  });

  it("keeps a fork head repo distinct from the base repo", async () => {
    const paginate = vi.fn().mockResolvedValue([
      {
        number: 10,
        title: "From a fork",
        head: {
          ref: "main",
          repo: { name: "fork", owner: { login: "contributor" } },
        },
        base: {
          ref: "main",
          repo: { name: "r", owner: { login: "o" } },
        },
      },
    ]);
    const octokit = mockOctokit({ paginate });
    const result = await listOpenPullRequests(octokit, {
      owner: "o",
      repo: "r",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value).toEqual([
      {
        number: 10,
        title: "From a fork",
        draft: false,
        headRef: "main",
        baseRef: "main",
        headRepo: { owner: "contributor", repo: "fork" },
        baseRepo: { owner: "o", repo: "r" },
      },
    ]);
  });

  it("omits a listed PR whose head repository is gone", async () => {
    const paginate = vi.fn().mockResolvedValue([
      {
        number: 10,
        title: "Deleted fork",
        head: { ref: "main", repo: null },
        base: {
          ref: "main",
          repo: { name: "r", owner: { login: "o" } },
        },
      },
    ]);
    const octokit = mockOctokit({ paginate });
    const result = await listOpenPullRequests(octokit, {
      owner: "o",
      repo: "r",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value).toEqual([]);
  });

  it("sanitizes a list failure so tokens never escape", async () => {
    const paginate = vi.fn().mockRejectedValue(requestError(403));
    const octokit = mockOctokit({ paginate });
    const result = await listOpenPullRequests(octokit, {
      owner: "o",
      repo: "r",
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
    expect(result.error.message).not.toContain(LEAKED_TOKEN);
  });

  it("rejects an ill-shaped list item as an unexpected response", async () => {
    const paginate = vi.fn().mockResolvedValue([{ number: "twelve" }]);
    const octokit = mockOctokit({ paginate });
    const result = await listOpenPullRequests(octokit, {
      owner: "o",
      repo: "r",
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
    expect(result.error.message).toContain("unexpected");
  });
});

describe("fetchDiff / compareDiff", () => {
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
    if (!result.ok) {
      throw new Error("unreachable");
    }
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
    if (!result.ok) {
      throw new Error("unreachable");
    }
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
    if (result.ok) {
      throw new Error("unreachable");
    }
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
    if (result.ok) {
      throw new Error("unreachable");
    }
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
    if (!result.ok) {
      throw new Error("unreachable");
    }
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

  it("flags a list at the 300-file compare cap as incomplete", async () => {
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
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.complete).toBe(false);
    expect(result.value.files).toHaveLength(300);
  });

  it("treats a missing files array as incomplete, absence proves nothing", async () => {
    const compareBasehead = vi.fn().mockResolvedValue({ data: {} });
    const octokit = mockOctokit({ compareBasehead });
    const result = await fetchCompareFiles(octokit, {
      owner: "o",
      repo: "r",
      base: "b",
      head: "h",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
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
    if (result.ok) {
      throw new Error("unreachable");
    }
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
    if (!result.ok) {
      throw new Error("unreachable");
    }
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
    if (result.ok) {
      throw new Error("unreachable");
    }
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
    if (!result.ok) {
      throw new Error("unreachable");
    }
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
    if (result.ok) {
      throw new Error("unreachable");
    }
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
    if (!result.ok) {
      throw new Error("unreachable");
    }
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
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(result.error.message).not.toContain(LEAKED_TOKEN);
  });
});

describe("fetchIssue", () => {
  const ISSUE_REF = { owner: "o", repo: "r", number: 12 };

  it("extracts title, state, labels, milestone and body", async () => {
    const issuesGet = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        title: "Add the thing",
        state: "closed",
        state_reason: "completed",
        labels: [{ name: "bug" }, "p1", { name: null }],
        milestone: { title: "v1.2" },
        body: "the body",
      },
    });
    const octokit = mockOctokit({ issuesGet });
    const result = await fetchIssue(octokit, ISSUE_REF);
    expect(issuesGet).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      issue_number: 12,
      request: { redirect: "manual" },
    });
    expect(result).toEqual({
      ok: true,
      value: {
        title: "Add the thing",
        state: "closed",
        stateReason: "completed",
        labels: ["bug", "p1"],
        milestone: "v1.2",
        body: "the body",
        isPullRequest: false,
      },
    });
  });

  it("normalizes a null body, milestone and state_reason", async () => {
    const issuesGet = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        title: "t",
        state: "open",
        state_reason: null,
        labels: [],
        milestone: null,
        body: null,
      },
    });
    const result = await fetchIssue(mockOctokit({ issuesGet }), ISSUE_REF);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.body).toBe("");
    expect(result.value.milestone).toBeNull();
    expect(result.value.stateReason).toBeNull();
    expect(result.value.labels).toEqual([]);
  });

  it("flags a payload carrying pull_request as a pull request", async () => {
    const issuesGet = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        title: "a PR",
        state: "open",
        labels: [],
        milestone: null,
        body: "",
        pull_request: { url: "https://api.github.com/repos/o/r/pulls/12" },
      },
    });
    const result = await fetchIssue(mockOctokit({ issuesGet }), ISSUE_REF);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.isPullRequest).toBe(true);
  });

  it("maps a 404 to a sanitized not-found error", async () => {
    const issuesGet = vi.fn().mockRejectedValue(requestError(404));
    const result = await fetchIssue(mockOctokit({ issuesGet }), ISSUE_REF);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(result.error.status).toBe(404);
    expect(JSON.stringify(result.error)).not.toContain(LEAKED_TOKEN);
  });
});
