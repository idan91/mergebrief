// Listing a PR's review comments since a time: the page walk is stubbed at
// the `octokit.paginate.iterator` seam, one response per page.
import { RequestError, type Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import { GitHubApiErrorCodes } from "../src/errors";
import { listReviewCommentsSince } from "../src/operations/review-comment-list";
import { LEAKED_TOKEN } from "./fixtures/graphql-error";

interface StubPage {
  readonly data: unknown[];
  readonly headers: { link?: string };
}

const NEXT_LINK = '<https://api.github.com/x?page=2>; rel="next"';

function stubOctokit(pages: readonly StubPage[] | Error): {
  octokit: Octokit;
  iterator: ReturnType<typeof vi.fn>;
} {
  const iterator = vi.fn(async function* () {
    if (pages instanceof Error) {
      throw pages;
    }
    yield* pages;
  });
  const listReviewComments = vi.fn();
  const stub = {
    paginate: Object.assign(vi.fn(), { iterator }),
    rest: { pulls: { listReviewComments } },
  };
  return { octokit: stub as unknown as Octokit, iterator };
}

const INPUT = {
  owner: "o",
  repo: "r",
  prNumber: 7,
  since: new Date("2026-10-06T10:00:00Z"),
};

function makeWireComment(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    pull_request_review_id: 500 + id,
    user: { id: 42 },
    path: "src/index.ts",
    body: `comment ${String(id)}`,
    subject_type: "line",
    line: 12,
    side: "RIGHT",
    start_line: 10,
    start_side: "RIGHT",
    ...extra,
  };
}

function makeRequestError(status: number): RequestError {
  return new RequestError(`status ${status}`, status, {
    request: {
      method: "GET",
      url: "https://api.github.com",
      headers: { authorization: `token ${LEAKED_TOKEN}` },
    },
    response: { status, url: "https://api.github.com", headers: {}, data: {} },
  });
}

describe("listReviewCommentsSince", () => {
  it("asks GitHub only for comments updated since the given time", async () => {
    const { octokit, iterator } = stubOctokit([{ data: [], headers: {} }]);

    await listReviewCommentsSince(octokit, INPUT);

    const [, params] = iterator.mock.calls[0] ?? [];
    expect(params).toMatchObject({
      owner: "o",
      repo: "r",
      pull_number: 7,
      since: "2026-10-06T10:00:00.000Z",
    });
  });

  it("reads every page into one list of anchored comments", async () => {
    const { octokit } = stubOctokit([
      { data: [makeWireComment(1)], headers: { link: NEXT_LINK } },
      {
        data: [
          makeWireComment(2, {
            subject_type: "file",
            line: null,
            side: null,
            start_line: null,
            start_side: null,
          }),
        ],
        headers: {},
      },
    ]);

    const listed = await listReviewCommentsSince(octokit, INPUT);

    expect(listed).toEqual({
      ok: true,
      value: {
        complete: true,
        comments: [
          {
            commentId: 1n,
            reviewId: 501n,
            authorId: 42n,
            path: "src/index.ts",
            body: "comment 1",
            subjectType: "line",
            line: 12,
            side: "RIGHT",
            startLine: 10,
            startSide: "RIGHT",
          },
          {
            commentId: 2n,
            reviewId: 502n,
            authorId: 42n,
            path: "src/index.ts",
            body: "comment 2",
            subjectType: "file",
          },
        ],
      },
    });
  });

  it("reads a comment's current and original positions apart", async () => {
    const { octokit } = stubOctokit([
      {
        data: [
          makeWireComment(3, {
            line: 15,
            start_line: 13,
            original_line: 12,
            original_start_line: 10,
          }),
          makeWireComment(4, {
            line: null,
            start_line: null,
            original_line: 30,
            original_start_line: 28,
          }),
        ],
        headers: {},
      },
    ]);

    const listed = await listReviewCommentsSince(octokit, INPUT);

    if (!listed.ok) {
      throw new Error("listing failed");
    }
    const [moved, outdated] = listed.value.comments;
    expect(moved).toMatchObject({
      line: 15,
      startLine: 13,
      originalLine: 12,
      originalStartLine: 10,
    });
    expect(outdated).toMatchObject({ originalLine: 30, originalStartLine: 28 });
    expect(outdated).not.toHaveProperty("line");
    expect(outdated).not.toHaveProperty("startLine");
  });

  it("skips an entry it cannot read rather than failing the list", async () => {
    const { octokit } = stubOctokit([
      {
        data: [{ id: "not a number" }, makeWireComment(4)],
        headers: {},
      },
    ]);

    const listed = await listReviewCommentsSince(octokit, INPUT);

    if (!listed.ok) {
      throw new Error("listing failed");
    }
    expect(listed.value.comments.map((row) => row.commentId)).toEqual([4n]);
  });

  it("stops at the page bound and reports the list as incomplete", async () => {
    const pages = Array.from({ length: 12 }, (_, index) => ({
      data: [makeWireComment(index + 1)],
      headers: { link: NEXT_LINK },
    }));
    const { octokit } = stubOctokit(pages);

    const listed = await listReviewCommentsSince(octokit, INPUT);

    if (!listed.ok) {
      throw new Error("listing failed");
    }
    expect(listed.value.complete).toBe(false);
    expect(listed.value.comments).toHaveLength(10);
  });

  it("answers a sanitized error when GitHub refuses the list", async () => {
    const { octokit } = stubOctokit(makeRequestError(502));

    const listed = await listReviewCommentsSince(octokit, INPUT);

    expect(listed.ok).toBe(false);
    if (listed.ok) {
      throw new Error("unreachable");
    }
    expect(listed.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
    expect(listed.error.status).toBe(502);
    expect(JSON.stringify(listed.error)).not.toContain(LEAKED_TOKEN);
  });
});
