import { describe, expect, it } from "vitest";

import { briefFixture } from "@web/features/brief/utils/fixtures";
import { buildBriefViewModel } from "@web/features/brief/utils";
import type { ReviewComment } from "../comments";
import type { RiskEvidence } from "../state";
import {
  createMindMapStore,
  deriveInitialState,
  type MindMapState,
} from "./store";
import { serializeSnapshot, snapshotToState } from "./snapshot";

const model = buildBriefViewModel(briefFixture);
const firstFlag = model.flags[0];
if (!firstFlag) throw new Error("Expected brief fixture to include risk flags");
const flagId = firstFlag.id;

function freshStore() {
  return createMindMapStore(deriveInitialState(model));
}

describe("deriveInitialState", () => {
  it("seeds open dispositions for every flag and dominant per group", () => {
    const state = deriveInitialState(model);
    expect(state.dispositions[flagId]).toEqual({ kind: "open" });
    expect(state.dominants["g1"]).toBe("bugfix");
    expect(state.reviewedChunks.size).toBe(0);
    expect(state.reviewOutcome).toBe("comment");
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

  it("reopens a flag (open carries no evidence by construction)", () => {
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
        chunkId: "chunk-a",
        file: "src/leak.ts",
        side: "new",
        startLine: 10,
        endLine: 10,
        rowIds: ["chunk-a:1"],
        selectedText: "validate(a);",
      },
      body: "first",
      status: "draft",
      collapsed: false,
    };
    const commentId = "chunk-a-new-10-10-1";
    store.getState().actions.saveComment(comment);
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

  it("submitted comments are immutable — update/delete no-op (BRIEF-23)", () => {
    const store = freshStore();
    const comment: Omit<ReviewComment, "id"> = {
      anchor: {
        chunkId: "chunk-a",
        file: "src/leak.ts",
        side: "new",
        startLine: 10,
        endLine: 10,
        rowIds: ["chunk-a:1"],
        selectedText: "validate(a);",
      },
      body: "posted text",
      status: "draft",
      collapsed: false,
    };
    store.getState().actions.saveComment(comment);
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

  it("markCommentsSubmitted flips exactly the given ids (BRIEF-23)", () => {
    const store = freshStore();
    const comment: Omit<ReviewComment, "id"> = {
      anchor: {
        chunkId: "chunk-a",
        file: "src/leak.ts",
        side: "new",
        startLine: 10,
        endLine: 10,
        rowIds: ["chunk-a:1"],
        selectedText: "validate(a);",
      },
      body: "first",
      status: "draft",
      collapsed: false,
    };
    store.getState().actions.saveComment(comment);
    const submittedId = store.getState().reviewComments[0]?.id;
    if (submittedId === undefined) throw new Error("expected a saved comment");

    // A draft added AFTER the submit was captured (mid-flight edit) must NOT
    // flip — it was never posted.
    store.getState().actions.saveComment({ ...comment, body: "mid-flight" });
    store.getState().actions.markCommentsSubmitted([submittedId]);

    const statuses = store.getState().reviewComments.map((c) => c.status);
    expect(statuses).toEqual(["submitted", "draft"]);
  });
});

describe("snapshot round-trip", () => {
  it("serializes Sets to arrays and restores them losslessly", () => {
    const store = freshStore();
    const actions = store.getState().actions;
    actions.reviewChunk("chunk-a");
    actions.disposeFlag([flagId], { kind: "dismissed", reason: "n/a here" });
    actions.reclassifyGroup("g1", "logic-refactor");
    actions.setOutcome("request-changes");

    const snapshot = serializeSnapshot("fixture-brief-1", store.getState());
    expect(snapshot.reviewedChunkIds).toEqual(["chunk-a"]);
    expect(snapshot.reclassifiedGroupIds).toEqual(["g1"]);

    const restored: MindMapState = snapshotToState(snapshot);
    expect(restored.reviewedChunks.has("chunk-a")).toBe(true);
    expect(restored.dispositions[flagId]).toEqual({
      kind: "dismissed",
      reason: "n/a here",
    });
    expect(restored.reviewOutcome).toBe("request-changes");
  });
});

describe("recordSubmittedReview", () => {
  it("appends the created review id and dedupes repeats (BRIEF-25 join keys)", () => {
    const store = freshStore();
    store.getState().actions.recordSubmittedReview(4_647_663_464);
    store.getState().actions.recordSubmittedReview(4_647_663_464);
    store.getState().actions.recordSubmittedReview(4_700_000_000);
    expect(store.getState().submittedReviewIds).toEqual([
      4_647_663_464, 4_700_000_000,
    ]);
  });
});

describe("setReplyDraft", () => {
  it("persists a draft per thread and clears on empty (BRIEF-25)", () => {
    const store = freshStore();
    store.getState().actions.setReplyDraft(9001, "half a thought");
    expect(store.getState().replyDrafts).toEqual({ "9001": "half a thought" });
    store.getState().actions.setReplyDraft(9001, "");
    expect(store.getState().replyDrafts).toEqual({});
  });
});
