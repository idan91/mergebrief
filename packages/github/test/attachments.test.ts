import type { Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import { GitHubApiErrorCodes } from "../src/errors";
import {
  extractImageSources,
  fetchRenderedImageSources,
} from "../src/operations/attachments";
import { LEAKED_TOKEN, graphqlResponseError } from "./fixtures/graphql-error";

function mockGraphqlOctokit(graphql: ReturnType<typeof vi.fn>): Octokit {
  const stub = { graphql };
  return stub as unknown as Octokit;
}

const INPUT = { owner: "o", repo: "r", prNumber: 7 } as const;
const SIGNED =
  "https://private-user-images.githubusercontent.com/1/2-3e5dffc4-bd05-4a01-98e8-1c519ba4cf00.png?jwt=abc";
const PUBLIC =
  "https://github.com/user-attachments/assets/96abe080-db23-4366-9eb8-32a76d148ae5";

function makeResponse(overrides: Record<string, unknown> = {}) {
  return {
    repository: {
      pullRequest: {
        bodyHTML: `<p>desc</p><img src="${PUBLIC}" alt="Image">`,
        comments: {
          nodes: [{ bodyHTML: `<a href="x"><img src="${SIGNED}"></a>` }],
        },
        reviews: { nodes: [null, { bodyHTML: "<p>lgtm</p>" }] },
        reviewThreads: {
          nodes: [
            null,
            {
              comments: {
                nodes: [{ bodyHTML: `<img alt="a" src="${SIGNED}">` }],
              },
            },
          ],
        },
        ...overrides,
      },
    },
  };
}

describe("extractImageSources", () => {
  it("reads every img src in document order", () => {
    expect(
      extractImageSources(
        `<img src="a"> text <img alt="x" src="b"><img src="">`,
      ),
    ).toEqual(["a", "b"]);
  });
});

describe("fetchRenderedImageSources", () => {
  it("collects sources from the description, comments, reviews and threads", async () => {
    const graphql = vi.fn().mockResolvedValue(makeResponse());

    const result = await fetchRenderedImageSources(
      mockGraphqlOctokit(graphql),
      INPUT,
    );

    expect(result).toEqual({ ok: true, value: [PUBLIC, SIGNED, SIGNED] });
    expect(graphql.mock.calls[0]?.[1]).toEqual({
      owner: "o",
      repo: "r",
      prNumber: 7,
    });
  });

  it("answers not-found when the pull request is missing", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValue({ repository: { pullRequest: null } });

    const result = await fetchRenderedImageSources(
      mockGraphqlOctokit(graphql),
      INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
  });

  it("maps a graphql error without leaking upstream text", async () => {
    const graphql = vi
      .fn()
      .mockRejectedValue(
        graphqlResponseError([{ type: "NOT_FOUND", message: LEAKED_TOKEN }]),
      );

    const result = await fetchRenderedImageSources(
      mockGraphqlOctokit(graphql),
      INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).not.toContain(LEAKED_TOKEN);
  });

  it("refuses an answer of an unexpected shape", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValue({ repository: { pullRequest: {} } });

    const result = await fetchRenderedImageSources(
      mockGraphqlOctokit(graphql),
      INPUT,
    );

    expect(result.ok).toBe(false);
  });
});
