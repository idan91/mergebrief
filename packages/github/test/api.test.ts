// Comment ops + fetch primitives against a hand-written, injected octokit stub
// (vitest `vi.fn()` — no new mock libraries). Asserts: success maps to the
// Result ok-shape; a 404 from deleteComment is idempotent ok; a 403/404 from a
// fetch maps to a sanitized Result error that leaks NO token/header/body.
import { RequestError, type Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import { deleteComment, postEntryComment } from "../src/comments";
import { GitHubApiErrorCode } from "../src/errors";
import { fetchPullRequest, fetchDiff } from "../src/pull-request";
import { fetchRepositoryById } from "../src/repo";
import { isRepoId } from "../src/ids";

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

// Build a minimal octokit stub. The double assertion is the sanctioned
// test-only escape hatch for injecting a structural mock where the full
// `Octokit` type is expected — we only implement the methods under test.
function mockOctokit(overrides: {
  createComment?: ReturnType<typeof vi.fn>;
  deleteComment?: ReturnType<typeof vi.fn>;
  pullsGet?: ReturnType<typeof vi.fn>;
  request?: ReturnType<typeof vi.fn>;
}): Octokit {
  const stub = {
    request: overrides.request ?? vi.fn(),
    rest: {
      issues: {
        createComment: overrides.createComment ?? vi.fn(),
        deleteComment: overrides.deleteComment ?? vi.fn(),
      },
      pulls: {
        get: overrides.pullsGet ?? vi.fn(),
      },
    },
  };
  return stub as unknown as Octokit;
}

function toRepoId(value: bigint) {
  if (!isRepoId(value)) throw new Error("expected a positive repo id");
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
    const createComment = vi.fn().mockResolvedValue({ data: { id: 9007199254740992 } });
    const octokit = mockOctokit({ createComment });
    const result = await postEntryComment(octokit, {
      owner: "o",
      repo: "r",
      prNumber: 7,
      body: "brief ready",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCode.REQUEST_FAILED);
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
    expect(result.error.code).toBe(GitHubApiErrorCode.FORBIDDEN);
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
    expect(result.error.code).toBe(GitHubApiErrorCode.REQUEST_FAILED);
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

  it("maps a 404 to a sanitized not-found error with no leaked token", async () => {
    const request = vi.fn().mockRejectedValue(requestError(404));
    const octokit = mockOctokit({ request });
    const result = await fetchRepositoryById(octokit, toRepoId(1n));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCode.NOT_FOUND);
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
    expect(result.error.code).toBe(GitHubApiErrorCode.REQUEST_FAILED);
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
    expect(result.error.code).toBe(GitHubApiErrorCode.RATE_LIMITED);
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
    expect(result.error.code).toBe(GitHubApiErrorCode.RATE_LIMITED);
  });

  it("keeps a plain 403 (with remaining budget) as forbidden", async () => {
    const request = vi
      .fn()
      .mockRejectedValue(requestError(403, { "x-ratelimit-remaining": "42" }));
    const octokit = mockOctokit({ request });
    const result = await fetchRepositoryById(octokit, toRepoId(1n));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCode.FORBIDDEN);
  });
});

describe("fetchPullRequest / fetchDiff", () => {
  it("extracts the minimal PR fields", async () => {
    const pullsGet = vi.fn().mockResolvedValue({
      data: {
        head: { sha: "head-sha" },
        base: { sha: "base-sha" },
        state: "open",
        draft: false,
        title: "A PR",
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
      headSha: "head-sha",
      baseSha: "base-sha",
      state: "open",
      draft: false,
      title: "A PR",
    });
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
    expect(result.error.code).toBe(GitHubApiErrorCode.NOT_FOUND);
    expect(result.error.message).not.toContain(LEAKED_TOKEN);
  });
});
