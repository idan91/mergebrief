import { describe, expect, it, vi } from "vitest";

import { briefFixture } from "@web/features/brief/fixtures";
import { buildBriefViewModel } from "@web/features/brief/utils";
import {
  CommentSides,
  ReviewCommentStatuses,
  type ReviewComment,
} from "../utils/comments";
import type { RiskEvidence } from "../utils/state";
import { createReviewSessionStore, deriveInitialState } from "./store";
import { serializeSnapshot } from "./snapshot";
import type { SessionWriteGateway } from "./writeGateway";
import type { SessionWriteResult } from "./writes";
import { CommentAnchorKinds } from "types";

const model = buildBriefViewModel(briefFixture);
const firstFlag = model.flags[0];
if (!firstFlag) throw new Error("Expected brief fixture to include risk flags");
const flagId = firstFlag.id;

function freshStore() {
  return createReviewSessionStore(deriveInitialState(model));
}

describe("deriveInitialState", () => {
  it("seeds open dispositions for every flag and dominant per group", () => {
    const state = deriveInitialState(model);
    expect(state.dispositions[flagId]).toEqual({ kind: "open" });
    expect(state.dominants["g1"]).toBe("bugfix");
    expect(state.reviewedChunks.size).toBe(0);
    expect(state.reviewOutcome).toBe("comment");
  });

  it("does not seed a remainder group into the reclassification map", () => {
    const withRemainder = buildBriefViewModel({
      ...briefFixture,
      unattributed: [
        {
          file: "src/orphan.ts",
          addedRanges: [{ start: 1, end: 1 }],
          removedRanges: [],
        },
      ],
    });
    const state = deriveInitialState(withRemainder);
    expect(state.dominants["g1"]).toBe("bugfix");
    expect(state.dominants["unattributed-remainder"]).toBeUndefined();
  });
});

describe("disposeFlag", () => {
  it("dismisses a batch with one shared reason atomically", () => {
    const store = freshStore();
    store.getState().actions.disposeFlag([flagId], {
      kind: "dismissed",
      reason: "not applicable",
    });
    expect(store.getState().dispositions[flagId]).toEqual({
      kind: "dismissed",
      reason: "not applicable",
    });
  });

  it("reopens a flag, and open carries no evidence by construction", () => {
    const store = freshStore();
    store.getState().actions.addressFlags(
      new Map([
        [
          flagId,
          {
            kind: "chunk-reviewed",
            chunkId: "chunk-a",
          },
        ],
      ]),
    );
    store.getState().actions.disposeFlag([flagId], { kind: "open" });
    expect(store.getState().dispositions[flagId]).toEqual({ kind: "open" });
  });

  it("is a no-op for an empty batch", () => {
    const store = freshStore();
    const before = store.getState().dispositions;
    store.getState().actions.disposeFlag([], { kind: "open" });
    expect(store.getState().dispositions).toBe(before);
  });
});

describe("addressFlags", () => {
  it("resolves evidence per flag", () => {
    const store = freshStore();
    const evidence: RiskEvidence = { kind: "manual-note", note: "checked" };
    store.getState().actions.addressFlags(new Map([[flagId, evidence]]));
    expect(store.getState().dispositions[flagId]).toEqual({
      kind: "addressed",
      evidence,
    });
  });
});

describe("reclassifyGroup", () => {
  it("sets the dominant and marks the group reclassified", () => {
    const store = freshStore();
    store.getState().actions.reclassifyGroup("g1", "logic-refactor");
    expect(store.getState().dominants["g1"]).toBe("logic-refactor");
    expect(store.getState().reclassifiedGroups.has("g1")).toBe(true);
  });
});

describe("reviewChunk", () => {
  it("toggles chunk membership", () => {
    const store = freshStore();
    store.getState().actions.reviewChunk("chunk-a");
    expect(store.getState().reviewedChunks.has("chunk-a")).toBe(true);
    store.getState().actions.reviewChunk("chunk-a");
    expect(store.getState().reviewedChunks.has("chunk-a")).toBe(false);
  });
});

describe("comments + outcome", () => {
  it("saves, updates, deletes comments and sets outcome", () => {
    const store = freshStore();
    const comment: Omit<ReviewComment, "id"> = {
      anchor: {
        kind: CommentAnchorKinds.LINE,
        chunkId: "chunk-a",
        file: "src/leak.ts",
        side: CommentSides.NEW,
        startLine: 10,
        endLine: 10,
        rowIds: ["chunk-a:1"],
        selectedText: "validate(a);",
      },
      body: "first",
      status: ReviewCommentStatuses.DRAFT,
      collapsed: false,
    };
    const commentId = "chunk-a-new-10-10-1";
    void store.getState().actions.saveComment(comment);
    expect(store.getState().reviewComments).toHaveLength(1);
    expect(store.getState().reviewComments[0]?.id).toBe(commentId);
    store.getState().actions.updateComment(commentId, "second");
    expect(store.getState().reviewComments[0]?.body).toBe("second");
    store.getState().actions.toggleComment(commentId);
    expect(store.getState().reviewComments[0]?.collapsed).toBe(true);
    store.getState().actions.deleteComment(commentId);
    expect(store.getState().reviewComments).toHaveLength(0);
    store.getState().actions.setOutcome("approve");
    expect(store.getState().reviewOutcome).toBe("approve");
  });

  it("a two-side anchor gets its own id with no same-side collision", () => {
    const store = freshStore();
    const anchor = {
      kind: CommentAnchorKinds.LINE,
      chunkId: "chunk-a",
      file: "src/leak.ts",
      side: CommentSides.NEW,
      startLine: 10,
      endLine: 12,
      rowIds: [] as string[],
      selectedText: "",
    };
    void store.getState().actions.saveComment({
      anchor,
      body: "same-side",
      status: ReviewCommentStatuses.DRAFT,
      collapsed: false,
    });
    void store.getState().actions.saveComment({
      anchor: { ...anchor, startSide: CommentSides.OLD },
      body: "two-side",
      status: ReviewCommentStatuses.DRAFT,
      collapsed: false,
    });
    const ids = store.getState().reviewComments.map((comment) => comment.id);
    expect(ids).toEqual(["chunk-a-new-10-12-1", "chunk-a-old-new-10-12-1"]);
  });

  it("submitted comments are immutable, update and delete no-op", () => {
    const store = freshStore();
    const comment: Omit<ReviewComment, "id"> = {
      anchor: {
        kind: CommentAnchorKinds.LINE,
        chunkId: "chunk-a",
        file: "src/leak.ts",
        side: CommentSides.NEW,
        startLine: 10,
        endLine: 10,
        rowIds: ["chunk-a:1"],
        selectedText: "validate(a);",
      },
      body: "posted text",
      status: ReviewCommentStatuses.DRAFT,
      collapsed: false,
    };
    void store.getState().actions.saveComment(comment);
    const id = store.getState().reviewComments[0]?.id;
    if (id === undefined) throw new Error("expected a saved comment");
    store.getState().actions.markCommentsSubmitted([id]);

    // GitHub is the system of record now: a local edit would silently diverge
    // from what was posted (a re-submit ships drafts only).
    store.getState().actions.updateComment(id, "silently changed");
    expect(store.getState().reviewComments[0]?.body).toBe("posted text");
    store.getState().actions.deleteComment(id);
    expect(store.getState().reviewComments).toHaveLength(1);
  });

  it("markCommentsSubmitted flips exactly the given ids", () => {
    const store = freshStore();
    const comment: Omit<ReviewComment, "id"> = {
      anchor: {
        kind: CommentAnchorKinds.LINE,
        chunkId: "chunk-a",
        file: "src/leak.ts",
        side: CommentSides.NEW,
        startLine: 10,
        endLine: 10,
        rowIds: ["chunk-a:1"],
        selectedText: "validate(a);",
      },
      body: "first",
      status: ReviewCommentStatuses.DRAFT,
      collapsed: false,
    };
    void store.getState().actions.saveComment(comment);
    const submittedId = store.getState().reviewComments[0]?.id;
    if (submittedId === undefined) throw new Error("expected a saved comment");

    // A draft added AFTER the submit was captured (mid-flight edit) must NOT
    // flip, it was never posted.
    void store
      .getState()
      .actions.saveComment({ ...comment, body: "mid-flight" });
    store.getState().actions.markCommentsSubmitted([submittedId]);

    const statuses = store.getState().reviewComments.map((c) => c.status);
    expect(statuses).toEqual(["submitted", "draft"]);
  });

  it("keys a file comment id on kind, path, and suffix", () => {
    const store = freshStore();
    void store.getState().actions.saveComment({
      anchor: { kind: CommentAnchorKinds.FILE, file: "src/leak.ts" },
      body: "on the file",
      status: ReviewCommentStatuses.DRAFT,
      collapsed: false,
    });
    expect(store.getState().reviewComments[0]?.id).toBe("file-src/leak.ts-1");
  });
});

describe("the Receipt's snapshot", () => {
  it("flattens the Sets the builder cannot read", () => {
    const store = freshStore();
    const actions = store.getState().actions;
    actions.reviewChunk("chunk-a");
    actions.disposeFlag([flagId], { kind: "dismissed", reason: "n/a here" });
    actions.reclassifyGroup("g1", "logic-refactor");
    actions.setOutcome("request-changes");

    const snapshot = serializeSnapshot("fixture-brief-1", store.getState());
    expect(snapshot.reviewedChunkIds).toEqual(["chunk-a"]);
    expect(snapshot.reclassifiedGroupIds).toEqual(["g1"]);
    expect(snapshot.dispositions[flagId]).toEqual({
      kind: "dismissed",
      reason: "n/a here",
    });
    expect(snapshot.reviewOutcome).toBe("request-changes");
  });
});

describe("recordSubmittedReview", () => {
  it("appends the created review id and dedupes repeats", () => {
    const store = freshStore();
    store.getState().actions.recordSubmittedReview(4_647_663_464);
    store.getState().actions.recordSubmittedReview(4_647_663_464);
    store.getState().actions.recordSubmittedReview(4_700_000_000);
    expect(store.getState().submittedReviewIds).toEqual([
      4_647_663_464, 4_700_000_000,
    ]);
  });
});

// ---------------------------------------------------------------------------
// Per-action writes: one operation per action, and a failure that returns the
// UI to the state where that same action is still available.
// ---------------------------------------------------------------------------

function anchorFor(chunkId: string): ReviewComment["anchor"] {
  return {
    kind: CommentAnchorKinds.LINE,
    chunkId,
    file: "src/leak.ts",
    side: CommentSides.NEW,
    startLine: 10,
    endLine: 10,
    rowIds: [`${chunkId}:1`],
    selectedText: "validate(a);",
  };
}

const OK: SessionWriteResult = { ok: true, value: undefined };
const FAILED: SessionWriteResult = {
  ok: false,
  failure: { frozen: false, copy: "review.writeError.failed" },
};
const FROZEN: SessionWriteResult = {
  ok: false,
  failure: { frozen: true, copy: "review.writeError.frozen" },
};

function gatewayMock(result: SessionWriteResult = OK) {
  const calls: string[] = [];
  const record = (name: string) => (): Promise<SessionWriteResult> => {
    calls.push(name);
    return Promise.resolve(result);
  };
  const gateway: SessionWriteGateway = {
    setRead: record("setRead"),
    dispose: record("dispose"),
    address: record("address"),
    reclassify: record("reclassify"),
    createComment: () => {
      calls.push("createComment");
      return Promise.resolve(
        result.ok ? { ok: true as const, value: "9001" } : result,
      );
    },
    updateComment: record("updateComment"),
    reanchorComment: record("reanchorComment"),
    deleteComment: record("deleteComment"),
    setOutcome: record("setOutcome"),
  };
  return {
    calls,
    store: createReviewSessionStore(deriveInitialState(model), () => gateway),
  };
}

describe("per-action writes", () => {
  it("fires exactly ONE operation per action", async () => {
    const { calls, store } = gatewayMock();
    store.getState().actions.reviewChunk("c1");
    store.getState().actions.setOutcome("approve");
    store.getState().actions.disposeFlag([flagId], { kind: "open" });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(["setRead", "setOutcome", "dispose"]);
  });

  it("un-ticks the checkbox when the read mark fails to save", async () => {
    const { store } = gatewayMock(FAILED);
    store.getState().actions.reviewChunk("c1");
    expect(store.getState().reviewedChunks.has("c1")).toBe(true);
    await vi.waitFor(() =>
      expect(store.getState().reviewedChunks.has("c1")).toBe(false),
    );
    expect(store.getState().writeError).toBe("review.writeError.failed");
  });

  it("puts a dismissed risk back to open when the write fails", async () => {
    const { store } = gatewayMock(FAILED);
    store
      .getState()
      .actions.disposeFlag([flagId], { kind: "dismissed", reason: "no" });
    expect(store.getState().dispositions[flagId]).toEqual({
      kind: "dismissed",
      reason: "no",
    });
    await vi.waitFor(() =>
      expect(store.getState().dispositions[flagId]).toEqual({ kind: "open" }),
    );
  });

  it("answers saveComment with the write's outcome and adopts the server id", async () => {
    const { store } = gatewayMock();
    const saved = await store.getState().actions.saveComment({
      anchor: anchorFor("c1"),
      body: "look here",
      status: ReviewCommentStatuses.DRAFT,
      collapsed: false,
    });
    expect(saved).toBe(true);
    expect(store.getState().reviewComments[0]?.id).toBe("9001");
  });

  it("never stages the draft when the write fails", async () => {
    const { store } = gatewayMock(FAILED);
    const saved = await store.getState().actions.saveComment({
      anchor: anchorFor("c1"),
      body: "look here",
      status: ReviewCommentStatuses.DRAFT,
      collapsed: false,
    });
    expect(saved).toBe(false);
    expect(store.getState().reviewComments).toHaveLength(0);
  });

  it("freezes the whole screen on a 409, rather than failing one action", async () => {
    const { store } = gatewayMock(FROZEN);
    store.getState().actions.reviewChunk("c1");
    await vi.waitFor(() => expect(store.getState().frozen).toBe(true));
    expect(store.getState().reviewedChunks.has("c1")).toBe(false);
    expect(store.getState().writeError).toBe("review.writeError.frozen");
  });

  it("keeps every action local when no writes are wired", async () => {
    const store = freshStore();
    store.getState().actions.reviewChunk("c1");
    expect(store.getState().reviewedChunks.has("c1")).toBe(true);
    store.getState().actions.setOutcome("approve");
    expect(store.getState().reviewOutcome).toBe("approve");
  });
});

describe("deleteMissingDraft", () => {
  it("writes for a carried draft the Brief renders nowhere", async () => {
    // The store never held it, no chunk covers its file, so the ordinary
    // delete has nothing to act on and the attention item could never clear.
    const { calls, store } = gatewayMock();
    store.getState().actions.deleteMissingDraft("4001");
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(["deleteComment"]);
    expect(store.getState().deletedMissingDrafts.has("4001")).toBe(true);
  });

  it("takes the deletion back when the write fails", async () => {
    const { store } = gatewayMock(FROZEN);
    store.getState().actions.deleteMissingDraft("4001");
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getState().deletedMissingDrafts.has("4001")).toBe(false);
  });
});
