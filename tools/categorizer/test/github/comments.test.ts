import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileAsync = vi.fn();

vi.mock("brief-core/gh-exec", () => ({
  execFileAsync: (...args: unknown[]) => execFileAsync(...args),
  MAX_BUFFER: 1024,
}));

const { fetchReviewCommentsCreatedBy, MAX_COMMENTS } =
  await import("../../src/github/comments");

const LOC = { owner: "o", repo: "r", number: 7 };
const CUTOFF = "2026-10-01T12:00:00Z";

function makeGhComment(id: number, createdAt?: string): unknown {
  return {
    id,
    path: "a.ts",
    line: 2,
    original_line: 2,
    subject_type: "line",
    body: `comment ${id}`,
    user: { login: "reviewer" },
    created_at: createdAt,
  };
}

function stubComments(comments: unknown[]): void {
  execFileAsync.mockResolvedValue({ stdout: JSON.stringify(comments) });
}

describe("fetchReviewCommentsCreatedBy", () => {
  beforeEach(() => {
    execFileAsync.mockReset();
  });

  it("keeps only comments created on or before the cutoff", async () => {
    stubComments([
      makeGhComment(1, "2026-10-01T11:59:59Z"),
      makeGhComment(2, CUTOFF),
      makeGhComment(3, "2026-10-01T12:00:01Z"),
      makeGhComment(4),
    ]);

    const comments = await fetchReviewCommentsCreatedBy(LOC, CUTOFF);

    expect(comments.map((comment) => comment.id)).toEqual(["1", "2"]);
    const [, args] = execFileAsync.mock.calls[0] ?? [];
    expect(args).toEqual(["api", "--paginate", "repos/o/r/pulls/7/comments"]);
  });

  it("compares instants, not timestamp text", async () => {
    stubComments([makeGhComment(1, "2026-10-01T13:30:00+02:00")]);

    const comments = await fetchReviewCommentsCreatedBy(LOC, CUTOFF);

    expect(comments.map((comment) => comment.id)).toEqual(["1"]);
  });

  it("applies the comment cap after the cutoff", async () => {
    const later = Array.from({ length: MAX_COMMENTS }, (_, index) =>
      makeGhComment(index + 100, "2026-10-02T00:00:00Z"),
    );
    stubComments([...later, makeGhComment(1, "2026-09-30T00:00:00Z")]);

    const comments = await fetchReviewCommentsCreatedBy(LOC, CUTOFF);

    expect(comments.map((comment) => comment.id)).toEqual(["1"]);
  });

  it("refuses a cutoff that is not a timestamp", async () => {
    stubComments([]);

    await expect(
      fetchReviewCommentsCreatedBy(LOC, "yesterday"),
    ).rejects.toThrow("yesterday");
  });
});
