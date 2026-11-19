// The aliased live read: one GraphQL call per page, a null entry for a pull
// request GitHub does not show, no entry for an alias GitHub refused, and
// the partial data of a throw folded back into a page.
import type { Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import { GitHubApiErrorCodes } from "../src/errors";
import {
  getLiveReadKey,
  LIVE_READ_PAGE_SIZE,
  readPullRequestFacts,
} from "../src/operations/live-read";
import { graphqlResponseError } from "./fixtures/graphql-error";

function mockGraphqlOctokit(graphql: ReturnType<typeof vi.fn>): Octokit {
  const stub = { graphql };
  return stub as unknown as Octokit;
}

const OPEN_PR = {
  databaseId: 424242,
  nameWithOwner: "o/r",
  pullRequest: {
    state: "OPEN",
    isDraft: false,
    title: "Add thing",
    closedAt: null,
    updatedAt: "2026-09-20T10:00:00Z",
    createdAt: "2026-09-01T08:00:00Z",
    headRefOid: "a".repeat(40),
    author: { login: "octocat" },
  },
};
const MERGED_PR = {
  databaseId: 424242,
  nameWithOwner: "o/r",
  pullRequest: {
    state: "MERGED",
    isDraft: true,
    title: "Done thing",
    closedAt: "2026-09-19T10:00:00Z",
    updatedAt: "2026-09-19T10:00:00Z",
    createdAt: "2026-09-02T08:00:00Z",
    headRefOid: "b".repeat(40),
    author: null,
  },
};
const REFS = [
  { owner: "o", repo: "r", prNumber: 7 },
  { owner: "o", repo: "r", prNumber: 8 },
  { owner: "gone", repo: "x", prNumber: 1 },
] as const;

describe("readPullRequestFacts", () => {
  it("maps every alias, null for a pull request GitHub does not show", async () => {
    const graphql = vi.fn().mockResolvedValue({
      p0: OPEN_PR,
      p1: MERGED_PR,
      p2: { databaseId: 9, nameWithOwner: "gone/x", pullRequest: null },
    });

    const result = await readPullRequestFacts(
      mockGraphqlOctokit(graphql),
      REFS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.get("o/r#7")).toEqual({
      repoId: 424242n,
      repoFullName: "o/r",
      state: "open",
      merged: false,
      draft: false,
      title: "Add thing",
      closedAt: null,
      updatedAt: new Date("2026-09-20T10:00:00Z"),
      createdAt: new Date("2026-09-01T08:00:00Z"),
      headSha: "a".repeat(40),
      authorLogin: "octocat",
    });
    expect(result.value.get("o/r#8")).toMatchObject({
      state: "closed",
      merged: true,
      draft: true,
      closedAt: new Date("2026-09-19T10:00:00Z"),
      authorLogin: null,
    });
    expect(result.value.get(getLiveReadKey(REFS[2]))).toBeNull();
    const [query, variables] = graphql.mock.calls[0] ?? [];
    expect(String(query)).toContain(
      "p2: repository(owner: $o2, name: $r2) { databaseId nameWithOwner",
    );
    expect(variables).toEqual({
      o0: "o",
      r0: "r",
      n0: 7,
      o1: "o",
      r1: "r",
      n1: 8,
      o2: "gone",
      r2: "x",
      n2: 1,
    });
  });

  it("folds a NOT_FOUND-only throw back into its partial data", async () => {
    const error = graphqlResponseError([
      { type: "NOT_FOUND", message: "Could not resolve to a Repository" },
    ]);
    Object.assign(error, { data: { p0: OPEN_PR, p1: null } });
    const graphql = vi.fn().mockRejectedValue(error);

    const result = await readPullRequestFacts(mockGraphqlOctokit(graphql), [
      REFS[0],
      REFS[2],
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.get("o/r#7")?.title).toBe("Add thing");
    expect(result.value.get("gone/x#1")).toBeNull();
  });

  it("withholds an alias GitHub refused and keeps the others", async () => {
    const error = graphqlResponseError([
      { type: "FORBIDDEN", message: "Resource protected by SAML" },
    ]);
    Object.assign(error, {
      errors: [{ type: "FORBIDDEN", message: "saml", path: ["p1"] }],
      data: { p0: OPEN_PR, p1: null, p2: null },
    });
    const graphql = vi.fn().mockRejectedValue(error);

    const result = await readPullRequestFacts(
      mockGraphqlOctokit(graphql),
      REFS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.get("o/r#7")?.title).toBe("Add thing");
    expect(result.value.has("o/r#8")).toBe(false);
    expect(result.value.get("gone/x#1")).toBeNull();
  });

  it("withholds every alias when each one was refused", async () => {
    const error = graphqlResponseError([{ type: "FORBIDDEN", message: "no" }]);
    Object.assign(error, {
      errors: [{ type: "FORBIDDEN", message: "no", path: ["p0"] }],
      data: { p0: null },
    });
    const graphql = vi.fn().mockRejectedValue(error);

    const result = await readPullRequestFacts(mockGraphqlOctokit(graphql), [
      REFS[0],
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.size).toBe(0);
  });

  it("fails the page when a refusal names no alias", async () => {
    const error = graphqlResponseError([{ type: "FORBIDDEN", message: "no" }]);
    Object.assign(error, {
      errors: [{ type: "FORBIDDEN", message: "no" }],
      data: { p0: null },
    });
    const graphql = vi.fn().mockRejectedValue(error);

    const result = await readPullRequestFacts(mockGraphqlOctokit(graphql), [
      REFS[0],
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
  });

  it("keeps a rate-limit failure a failure", async () => {
    const graphql = vi
      .fn()
      .mockRejectedValue(
        graphqlResponseError([{ type: "RATE_LIMITED", message: "slow down" }]),
      );

    const result = await readPullRequestFacts(mockGraphqlOctokit(graphql), [
      REFS[0],
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.RATE_LIMITED);
    expect(result.error.message).not.toContain("slow down");
  });

  it("makes no call for no refs and refuses more than a page", async () => {
    const graphql = vi.fn();
    const octokit = mockGraphqlOctokit(graphql);

    const empty = await readPullRequestFacts(octokit, []);
    expect(empty.ok).toBe(true);
    expect(graphql).not.toHaveBeenCalled();

    const tooMany = Array.from({ length: LIVE_READ_PAGE_SIZE + 1 }, (_, i) => ({
      owner: "o",
      repo: "r",
      prNumber: i + 1,
    }));
    await expect(readPullRequestFacts(octokit, tooMany)).rejects.toThrow(
      "at most",
    );
  });

  it("rejects a response whose shape drifted", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValue({ p0: { ...OPEN_PR, pullRequest: {} } });

    const result = await readPullRequestFacts(mockGraphqlOctokit(graphql), [
      REFS[0],
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });
});
