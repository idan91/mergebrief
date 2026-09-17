// @vitest-environment jsdom
import { appI18n } from "../../../../i18n/I18nProvider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CommentSides,
  ReviewCommentStatuses,
  type CommentAnchor,
} from "../../utils/comments";
import { CommentAnchorKinds } from "types/comments";
import {
  createReviewFlowStore,
  readExpansion,
  type ReviewFlowPosture,
  type ReviewFlowSessionActions,
  type ReviewFlowStore,
} from "./store";

const anchor: CommentAnchor = {
  kind: CommentAnchorKinds.LINE,
  chunkId: "chunk-a",
  file: "src/a.ts",
  side: CommentSides.NEW,
  startLine: 10,
  endLine: 10,
  rowIds: ["row-1"],
  selectedText: "validate(a);",
};

function writablePosture(): ReviewFlowPosture {
  return {
    composerDisabledReason: undefined,
    flagsReadOnly: false,
    postingCommentIds: new Set(),
    postBlockedExternally: undefined,
    postComment: undefined,
  };
}

function sessionMock(): ReviewFlowSessionActions {
  return {
    saveComment: vi.fn(() => Promise.resolve(true)),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
    toggleComment: vi.fn(),
    reanchorComment: vi.fn(),
  };
}

function flushAnnounce() {
  vi.advanceTimersByTime(50);
}

describe("ReviewFlow store", () => {
  let session: ReviewFlowSessionActions;
  let store: ReviewFlowStore;

  beforeEach(() => {
    vi.useFakeTimers();
    session = sessionMock();
    store = createReviewFlowStore(session, writablePosture(), appI18n.t);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("hunk edge expansion", () => {
    it("records the lines an edge just read", () => {
      store.getState().actions.expandEdge("chunk-a:3:down", {
        start: 2,
        end: 21,
      });

      expect(readExpansion(store.getState(), "chunk-a:3:down")).toEqual({
        range: { start: 2, end: 21 },
        ranges: [{ start: 2, end: 21 }],
      });
    });

    it("widens an edge that has already expanded once", () => {
      const actions = store.getState().actions;
      actions.expandEdge("chunk-a:3:down", { start: 2, end: 21 });
      actions.expandEdge("chunk-a:3:down", { start: 22, end: 41 }, 60);

      expect(readExpansion(store.getState(), "chunk-a:3:down")).toEqual({
        range: { start: 2, end: 41 },
        ranges: [
          { start: 2, end: 21 },
          { start: 22, end: 41 },
        ],
        totalLines: 60,
      });
    });

    it("records the file end by path when the read names it", () => {
      const actions = store.getState().actions;
      actions.expandEdge(
        "chunk-a:3:down",
        { start: 2, end: 21 },
        60,
        "src/a.ts",
      );
      actions.expandEdge(
        "chunk-b:9:up",
        { start: 30, end: 49 },
        undefined,
        "src/a.ts",
      );

      expect(store.getState().fileEnds.get("src/a.ts")).toBe(60);
    });

    it("keeps the file end once a read has reported it", () => {
      const actions = store.getState().actions;
      actions.expandEdge("chunk-a:3:down", { start: 2, end: 21 }, 60);
      actions.expandEdge("chunk-a:3:down", { start: 22, end: 41 });

      expect(
        readExpansion(store.getState(), "chunk-a:3:down")?.totalLines,
      ).toBe(60);
    });

    it("keeps each edge of each chunk apart", () => {
      const actions = store.getState().actions;
      actions.expandEdge("chunk-a:3:down", { start: 2, end: 21 });

      expect(readExpansion(store.getState(), "chunk-a:3:up")).toBeUndefined();
    });
  });

  describe("composer", () => {
    it("opens at the anchor when writable", () => {
      store.getState().actions.openComposer(anchor);
      expect(store.getState().composerAnchor).toEqual(anchor);
      expect(store.getState().composerHost).toBe(anchor.chunkId);
    });

    it("opens in the card that picked the rows when it is not the owner", () => {
      store.getState().actions.openComposer(anchor, "chunk-b");
      expect(store.getState().composerHost).toBe("chunk-b");
      store.getState().actions.cancelComposer();
      expect(store.getState().composerHost).toBeNull();
    });

    it("announces the read-only reason instead of opening", () => {
      store.setState({ composerDisabledReason: "Historical revision." });
      store.getState().actions.openComposer(anchor);
      expect(store.getState().composerAnchor).toBeNull();
      flushAnnounce();
      expect(store.getState().toast).toBe("Historical revision.");
    });

    it("closes the composer on write SUCCESS, not on click", async () => {
      store.getState().actions.openComposer(anchor);
      void store.getState().actions.saveComment(anchor, "  looks wrong  ");
      expect(session.saveComment).toHaveBeenCalledWith({
        anchor,
        body: "looks wrong",
        status: ReviewCommentStatuses.DRAFT,
        collapsed: false,
      });
      // Still open, and saying so, while the write is in flight.
      expect(store.getState().composerAnchor).toEqual(anchor);
      expect(store.getState().composerSaving).toBe(true);
      await vi.runAllTimersAsync();
      expect(store.getState().composerAnchor).toBeNull();
      expect(store.getState().composerSaving).toBe(false);
      flushAnnounce();
      expect(store.getState().toast).toBe(
        "Draft comment added to this review.",
      );
    });

    it("leaves the composer open when the write fails", async () => {
      session.saveComment = vi.fn(() => Promise.resolve(false));
      store = createReviewFlowStore(session, writablePosture(), appI18n.t);
      store.getState().actions.openComposer(anchor);
      void store.getState().actions.saveComment(anchor, "looks wrong");
      await vi.runAllTimersAsync();
      expect(store.getState().composerAnchor).toEqual(anchor);
      expect(store.getState().composerSaving).toBe(false);
    });

    it("refuses a second save while one is in flight", async () => {
      store.getState().actions.openComposer(anchor);
      void store.getState().actions.saveComment(anchor, "one");
      void store.getState().actions.saveComment(anchor, "two");
      expect(session.saveComment).toHaveBeenCalledTimes(1);
      await vi.runAllTimersAsync();
    });

    it("rejects an empty body and keeps the composer open", () => {
      store.getState().actions.openComposer(anchor);
      void store.getState().actions.saveComment(anchor, "   ");
      expect(session.saveComment).not.toHaveBeenCalled();
      expect(store.getState().composerAnchor).toEqual(anchor);
      flushAnnounce();
      expect(store.getState().toast).toBe("Comment cannot be empty.");
    });

    it("updates through the session actions with trimmed body", () => {
      store.getState().actions.updateComment("id-1", " edited ");
      expect(session.updateComment).toHaveBeenCalledWith("id-1", "edited");
    });

    it("rejects an empty update", () => {
      store.getState().actions.updateComment("id-1", " ");
      expect(session.updateComment).not.toHaveBeenCalled();
    });

    it("deletes and toggles through the session actions", () => {
      store.getState().actions.deleteComment("id-1");
      store.getState().actions.toggleComment("id-2");
      expect(session.deleteComment).toHaveBeenCalledWith("id-1");
      expect(session.toggleComment).toHaveBeenCalledWith("id-2");
    });
  });

  describe("risk selection", () => {
    it("toggles a single flag in and out", () => {
      const { actions } = store.getState();
      actions.toggleRiskFlag("f1");
      expect(store.getState().selectedRiskFlags).toEqual(new Set(["f1"]));
      actions.toggleRiskFlag("f1");
      expect(store.getState().selectedRiskFlags).toEqual(new Set());
    });

    it("selects the whole group when any member is unselected", () => {
      store.getState().actions.toggleRiskFlag("f1");
      store.getState().actions.toggleRiskGroup(["f1", "f2"]);
      expect(store.getState().selectedRiskFlags).toEqual(new Set(["f1", "f2"]));
    });

    it("deselects the whole group when every member is selected", () => {
      store.setState({ selectedRiskFlags: new Set(["f1", "f2", "other"]) });
      store.getState().actions.toggleRiskGroup(["f1", "f2"]);
      expect(store.getState().selectedRiskFlags).toEqual(new Set(["other"]));
    });

    it("leaves the selection unchanged for an empty group", () => {
      store.setState({ selectedRiskFlags: new Set(["f1"]) });
      const before = store.getState().selectedRiskFlags;
      store.getState().actions.toggleRiskGroup([]);
      expect(store.getState().selectedRiskFlags).toBe(before);
    });

    it("clears only the given flags from the selection", () => {
      store.setState({ selectedRiskFlags: new Set(["f1", "f2", "f3"]) });
      store.getState().actions.clearRiskSelection(["f1", "f3"]);
      expect(store.getState().selectedRiskFlags).toEqual(new Set(["f2"]));
    });
  });

  describe("conversation thread expansion", () => {
    const CHUNK_A = "src/a.ts#c1";
    const CHUNK_B = "src/b.ts#c1";

    it("toggles a thread in and out per chunk key", () => {
      store.getState().actions.toggleConversationThread(CHUNK_A, 9001);
      expect(
        store.getState().expandedConversations.get(CHUNK_A)?.has(9001),
      ).toBe(true);
      store.getState().actions.toggleConversationThread(CHUNK_A, 9001);
      expect(
        store.getState().expandedConversations.get(CHUNK_A)?.has(9001) ?? false,
      ).toBe(false);
    });

    it("keeps chunk keys independent across chunks", () => {
      store.getState().actions.toggleConversationThread(CHUNK_A, 9001);
      store.getState().actions.toggleConversationThread(CHUNK_B, 9001);
      store.getState().actions.toggleConversationThread(CHUNK_B, 9001);
      expect(
        store.getState().expandedConversations.get(CHUNK_A)?.has(9001),
      ).toBe(true);
      expect(
        store.getState().expandedConversations.get(CHUNK_B)?.has(9001) ?? false,
      ).toBe(false);
    });

    it("leaves other chunks' set references untouched on a toggle", () => {
      store.getState().actions.toggleConversationThread(CHUNK_A, 9001);
      const before = store.getState().expandedConversations.get(CHUNK_A);
      store.getState().actions.toggleConversationThread(CHUNK_B, 42);
      expect(store.getState().expandedConversations.get(CHUNK_A)).toBe(before);
    });
  });

  describe("announce", () => {
    it("clears then sets, so a repeat message re-announces", () => {
      store.getState().actions.announce("Saved.");
      flushAnnounce();
      expect(store.getState().toast).toBe("Saved.");
      store.getState().actions.announce("Saved.");
      expect(store.getState().toast).toBe("");
      flushAnnounce();
      expect(store.getState().toast).toBe("Saved.");
    });

    it("drops a superseded pending message", () => {
      store.getState().actions.announce("first");
      store.getState().actions.announce("second");
      flushAnnounce();
      expect(store.getState().toast).toBe("second");
    });

    it("clearToast hides the message", () => {
      store.getState().actions.announce("visible");
      flushAnnounce();
      store.getState().actions.clearToast();
      expect(store.getState().toast).toBe("");
    });
  });

  describe("review comment draft", () => {
    it("starts empty and sets verbatim", () => {
      expect(store.getState().reviewComment).toBe("");
      store.getState().actions.setReviewComment("Solid change.  ");
      expect(store.getState().reviewComment).toBe("Solid change.  ");
    });

    it("consumes the draft when it still equals the shipped text", () => {
      store.getState().actions.setReviewComment("Solid change.");
      store.getState().actions.consumeReviewComment("Solid change.");
      expect(store.getState().reviewComment).toBe("");
    });

    it("keeps an edit made after the shipped text was captured", () => {
      // Capture-at-initiation: a mid-flight edit is user content.
      // The success sweep must not silently drop it.
      store.getState().actions.setReviewComment("Solid change.");
      store.getState().actions.setReviewComment("Solid change, but check X.");
      store.getState().actions.consumeReviewComment("Solid change.");
      expect(store.getState().reviewComment).toBe("Solid change, but check X.");
    });
  });
});
