import { describe, expect, it } from "vitest";

import { parseDeltaBrief } from "./validation";

describe("parseDeltaBrief", () => {
  it("accepts the demo delta sidecar shape", () => {
    expect(parseDeltaBrief({
      previousSha: "abc1234",
      currentSha: "def5678",
      summary: "Author pushed three focused follow-up changes.",
      newChunkIds: ["chunk-a"],
      changedChunkIds: ["chunk-b"],
      reopenedRiskFlagIds: ["chunk-b-no-tests-0"],
      movedCommentAnchors: [{ commentId: "comment-1", from: "src/a.ts:+10", to: "src/a.ts:+14" }],
      orphanedCommentIds: ["comment-2"],
      stillResolvedRiskFlagIds: ["chunk-c-no-tests-0"],
    })).toEqual({
      ok: true,
      value: {
        previousSha: "abc1234",
        currentSha: "def5678",
        summary: "Author pushed three focused follow-up changes.",
        newChunkIds: ["chunk-a"],
        changedChunkIds: ["chunk-b"],
        reopenedRiskFlagIds: ["chunk-b-no-tests-0"],
        movedCommentAnchors: [{ commentId: "comment-1", from: "src/a.ts:+10", to: "src/a.ts:+14" }],
        orphanedCommentIds: ["comment-2"],
        stillResolvedRiskFlagIds: ["chunk-c-no-tests-0"],
      },
    });
  });

  it("rejects malformed moved comment anchors", () => {
    const parsed = parseDeltaBrief({
      previousSha: "abc1234",
      currentSha: "def5678",
      summary: "Changed",
      newChunkIds: [],
      changedChunkIds: [],
      reopenedRiskFlagIds: [],
      movedCommentAnchors: [{ commentId: "comment-1", from: "src/a.ts:+10" }],
      orphanedCommentIds: [],
      stillResolvedRiskFlagIds: [],
    });

    expect(parsed.ok).toBe(false);
  });
});
