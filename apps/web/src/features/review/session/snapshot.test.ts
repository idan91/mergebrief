// @vitest-environment jsdom
// Durable submitted-flip (BRIEF-23): a submit can resolve AFTER the brief's
// provider unmounted (its persistence subscriber is gone), so the flip must
// write to sessionStorage directly — otherwise the reloaded session re-ships
// the same comments as drafts and double-posts them.
import { beforeEach, describe, expect, it } from "vitest";

import type { ReviewComment } from "../utils/comments";
import {
  markSnapshotCommentsSubmitted,
  readSnapshot,
  writeSnapshot,
  type SessionSnapshot,
} from "./snapshot";

const BRIEF_ID = "db:1:7:base:head";

function comment(id: string, status: ReviewComment["status"]): ReviewComment {
  return {
    id,
    anchor: {
      chunkId: "chunk-a",
      file: "src/a.ts",
      side: "new",
      startLine: 3,
      endLine: 3,
      rowIds: ["chunk-a:0"],
      selectedText: "x",
    },
    body: "note",
    status,
    collapsed: false,
  };
}

function snapshot(comments: ReviewComment[]): SessionSnapshot {
  return {
    briefId: BRIEF_ID,
    dispositions: {},
    dominants: {},
    reclassifiedGroupIds: [],
    reviewedChunkIds: [],
    reviewComments: comments,
    reviewOutcome: "approve",
  };
}

describe("markSnapshotCommentsSubmitted", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("flips exactly the given ids in the persisted snapshot", () => {
    writeSnapshot(snapshot([comment("a", "draft"), comment("b", "draft")]));
    markSnapshotCommentsSubmitted(BRIEF_ID, ["a"]);
    const stored = readSnapshot(BRIEF_ID);
    expect(stored?.reviewComments.map((c) => c.status)).toEqual([
      "submitted",
      "draft",
    ]);
  });

  it("no-ops safely when nothing is persisted for the brief", () => {
    expect(() => markSnapshotCommentsSubmitted(BRIEF_ID, ["a"])).not.toThrow();
    expect(readSnapshot(BRIEF_ID)).toBeUndefined();
  });

  it("resets the outcome to comment when the verdict was delivered", () => {
    // An approve/request-changes was posted: the persisted session must not
    // re-arm the same verdict for the next submit (a follow-up defaults to a
    // comment-only review).
    writeSnapshot(snapshot([comment("a", "draft")]));
    markSnapshotCommentsSubmitted(BRIEF_ID, ["a"], true);
    expect(readSnapshot(BRIEF_ID)?.reviewOutcome).toBe("comment");
  });

  it("resets the outcome even for a comment-less verdict submit", () => {
    writeSnapshot(snapshot([]));
    markSnapshotCommentsSubmitted(BRIEF_ID, [], true);
    expect(readSnapshot(BRIEF_ID)?.reviewOutcome).toBe("comment");
  });
});

describe("submittedReviewIds (BRIEF-25)", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("round-trips through write + read", () => {
    writeSnapshot({ ...snapshot([]), submittedReviewIds: [4_647_663_464] });
    expect(readSnapshot(BRIEF_ID)?.submittedReviewIds).toEqual([4_647_663_464]);
  });

  it("accepts a pre-BRIEF-25 snapshot without the key (legacy tolerance)", () => {
    writeSnapshot(snapshot([]));
    const stored = readSnapshot(BRIEF_ID);
    expect(stored).toBeDefined();
    expect(stored?.submittedReviewIds).toBeUndefined();
  });

  it("markSnapshotCommentsSubmitted records the review id durably in the same write", () => {
    writeSnapshot(snapshot([comment("a", "draft")]));
    markSnapshotCommentsSubmitted(BRIEF_ID, ["a"], false, 4_647_663_464);
    const stored = readSnapshot(BRIEF_ID);
    expect(stored?.submittedReviewIds).toEqual([4_647_663_464]);
    expect(stored?.reviewComments[0]?.status).toBe("submitted");
    // Repeat records dedupe.
    markSnapshotCommentsSubmitted(BRIEF_ID, [], false, 4_647_663_464);
    expect(readSnapshot(BRIEF_ID)?.submittedReviewIds).toEqual([4_647_663_464]);
  });
});

describe("replyDrafts (BRIEF-25)", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("round-trips through write + read and tolerates absence (legacy)", () => {
    writeSnapshot({ ...snapshot([]), replyDrafts: { "9001": "draft" } });
    expect(readSnapshot(BRIEF_ID)?.replyDrafts).toEqual({ "9001": "draft" });
    window.sessionStorage.clear();
    writeSnapshot(snapshot([]));
    expect(readSnapshot(BRIEF_ID)).toBeDefined();
  });
});
