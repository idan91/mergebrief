import { describe, expect, it, vi } from "vitest";
import type * as FetchModule from "../../src/github/fetch";

// The port must delegate to the gh functions one-to-one: a drifted binding
// (e.g. metadata wired to diff) would surface as baffling generation bugs.
const fetchMocks = vi.hoisted(() => ({
  fetchPrMetadata: vi.fn(async () => ({ title: "m" })),
  fetchPrDiff: vi.fn(async () => "pr-diff"),
  fetchCompareDiff: vi.fn(async () => "cmp-diff"),
  fetchCompareCommitCount: vi.fn(async () => 3),
  resolveFullSha: vi.fn(async () => "f".repeat(40)),
}));
const commentMocks = vi.hoisted(() => ({
  fetchReviewComments: vi.fn(async () => []),
}));

vi.mock("../../src/github/fetch", async (importOriginal) => ({
  // Keep the folder-internal `repoSlug` `comments.ts` imports at module load;
  // only the port-backed functions are stubbed.
  ...(await importOriginal<typeof FetchModule>()),
  ...fetchMocks,
}));
vi.mock("../../src/github/comments", () => commentMocks);

const { ghPrSource } = await import("../../src/github/source");

const LOC = { owner: "o", repo: "r", number: 7 };

describe("ghPrSource", () => {
  it("delegates every port method to its gh function with the same args", async () => {
    await expect(ghPrSource.fetchPrMetadata(LOC)).resolves.toEqual({
      title: "m",
    });
    expect(fetchMocks.fetchPrMetadata).toHaveBeenCalledWith(LOC);

    await expect(ghPrSource.fetchPrDiff(LOC)).resolves.toBe("pr-diff");
    expect(fetchMocks.fetchPrDiff).toHaveBeenCalledWith(LOC);

    await expect(ghPrSource.fetchCompareDiff(LOC, "a1", "b2")).resolves.toBe(
      "cmp-diff",
    );
    expect(fetchMocks.fetchCompareDiff).toHaveBeenCalledWith(LOC, "a1", "b2");

    await expect(ghPrSource.fetchReviewComments(LOC)).resolves.toEqual([]);
    expect(commentMocks.fetchReviewComments).toHaveBeenCalledWith(LOC);

    await expect(
      ghPrSource.fetchCompareCommitCount(LOC, "a1", "b2"),
    ).resolves.toBe(3);
    expect(fetchMocks.fetchCompareCommitCount).toHaveBeenCalledWith(
      LOC,
      "a1",
      "b2",
    );

    await expect(ghPrSource.resolveFullSha(LOC, "abc1234")).resolves.toBe(
      "f".repeat(40),
    );
    expect(fetchMocks.resolveFullSha).toHaveBeenCalledWith(LOC, "abc1234");
  });
});
