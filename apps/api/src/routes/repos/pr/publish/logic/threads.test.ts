import {
  GitHubApiErrorCodes,
  ReviewSubjectTypes,
  type AddReviewThreadInput,
  type GitHubCallFailure,
  type ReviewThread,
} from "github";
import type { Result } from "types/utils";
import { describe, expect, it, vi } from "vitest";
import type { PostThread, PublishComment } from "../types";
import { postReviewThreads } from "./threads";

const FILE_COMMENT: PublishComment = {
  anchor: { path: "src/app.ts", subjectType: ReviewSubjectTypes.FILE },
  body: "on the file",
};
const LINE_COMMENT: PublishComment = {
  anchor: { path: "src/a.ts", line: 12, side: "RIGHT" },
  body: "anchored note",
};
const RANGE_COMMENT: PublishComment = {
  anchor: {
    path: "src/b.ts",
    line: 30,
    side: "LEFT",
    startLine: 25,
    startSide: "LEFT",
  },
  body: "multi-line note",
};

type PostResult = Result<ReviewThread, GitHubCallFailure>;

function makeLandedResult(): PostResult {
  return { ok: true, value: { threadId: "PRRT_x" } };
}
function makeRefusedResult(error: GitHubCallFailure): PostResult {
  return { ok: false, error };
}
function makeRejectedResult(): PostResult {
  return makeRefusedResult({
    code: GitHubApiErrorCodes.ANCHOR_REJECTED,
    message: "failed to add pull request review thread: anchor rejected",
  });
}
function makeFailedResult(): PostResult {
  return makeRefusedResult({
    code: GitHubApiErrorCodes.REQUEST_FAILED,
    message: "failed to add pull request review thread",
  });
}

function hasNotExpired(): boolean {
  return false;
}

function stubPost(results: readonly PostResult[]): PostThread {
  const queue = [...results];
  return vi.fn(async (_input: AddReviewThreadInput) => {
    const next = queue.shift();
    if (next === undefined) {
      throw new Error("stub: no result queued");
    }
    return next;
  });
}

describe("postReviewThreads", () => {
  it("posts every comment in order and lands them all", async () => {
    const post = stubPost([
      makeLandedResult(),
      makeLandedResult(),
      makeLandedResult(),
    ]);
    const result = await postReviewThreads(
      post,
      "PRR_node",
      [LINE_COMMENT, FILE_COMMENT, RANGE_COMMENT],
      hasNotExpired,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.landed).toEqual([
      LINE_COMMENT,
      FILE_COMMENT,
      RANGE_COMMENT,
    ]);
    expect(result.value.rejected).toEqual([]);
    expect(post).toHaveBeenCalledTimes(3);
    expect(post).toHaveBeenNthCalledWith(2, {
      reviewNodeId: "PRR_node",
      subjectType: ReviewSubjectTypes.FILE,
      path: "src/app.ts",
      body: "on the file",
    });
  });

  it("keeps posting past a rejected anchor and reports it", async () => {
    const post = stubPost([
      makeLandedResult(),
      makeRejectedResult(),
      makeLandedResult(),
    ]);
    const result = await postReviewThreads(
      post,
      "PRR_node",
      [LINE_COMMENT, FILE_COMMENT, RANGE_COMMENT],
      hasNotExpired,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.landed).toEqual([LINE_COMMENT, RANGE_COMMENT]);
    expect(result.value.rejected).toEqual([FILE_COMMENT]);
    expect(post).toHaveBeenCalledTimes(3);
  });

  it("stops at a transport failure and returns it whole", async () => {
    const post = stubPost([makeLandedResult(), makeFailedResult()]);
    const result = await postReviewThreads(
      post,
      "PRR_node",
      [LINE_COMMENT, FILE_COMMENT, RANGE_COMMENT],
      hasNotExpired,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error).toEqual({
      code: GitHubApiErrorCodes.REQUEST_FAILED,
      message: "failed to add pull request review thread",
    });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("lands nothing and posts nothing for an empty review", async () => {
    const post = stubPost([]);
    const result = await postReviewThreads(post, "PRR_node", [], hasNotExpired);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value).toEqual({ landed: [], rejected: [] });
    expect(post).not.toHaveBeenCalled();
  });
});
