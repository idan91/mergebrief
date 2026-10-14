// @vitest-environment jsdom
import { appI18n } from "../../../../i18n/I18nProvider";
import { RequestBounds } from "contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type CommentAnchor } from "../../utils/comments";
import {
  CommentAnchorKinds,
  DiffSides,
  DraftCommentStatuses,
} from "types/comments";
import {
  createReviewFlowStore,
  type ReviewFlowSessionActions,
  type ReviewFlowStore,
} from "./store";

const anchor: CommentAnchor = {
  kind: CommentAnchorKinds.LINE,
  chunkId: "chunk-a",
  file: "src/a.ts",
  side: DiffSides.NEW,
  startLine: 10,
  endLine: 10,
  rowIds: ["row-1"],
  selectedText: "validate(a);",
};

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
    store = createReviewFlowStore(session, appI18n.t);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("composer", () => {
    it("opens at the anchor when writable", () => {
      store.getState().actions.openComposer(anchor, undefined);
      expect(store.getState().composerAnchor).toEqual(anchor);
      expect(store.getState().composerHost).toBe(anchor.chunkId);
    });

    it("opens in the card that picked the rows when it is not the owner", () => {
      store.getState().actions.openComposer(anchor, undefined, "chunk-b");
      expect(store.getState().composerHost).toBe("chunk-b");
      store.getState().actions.cancelComposer();
      expect(store.getState().composerHost).toBeNull();
    });

    it("announces the read-only reason instead of opening", () => {
      store.getState().actions.openComposer(anchor, "Historical revision.");
      expect(store.getState().composerAnchor).toBeNull();
      flushAnnounce();
      expect(store.getState().toast).toBe("Historical revision.");
    });

    it("closes the composer on write SUCCESS, not on click", async () => {
      store.getState().actions.openComposer(anchor, undefined);
      void store.getState().actions.saveComment(anchor, "  looks wrong  ");
      expect(session.saveComment).toHaveBeenCalledWith({
        anchor,
        body: "looks wrong",
        status: DraftCommentStatuses.DRAFT,
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
      store = createReviewFlowStore(session, appI18n.t);
      store.getState().actions.openComposer(anchor, undefined);
      void store.getState().actions.saveComment(anchor, "looks wrong");
      await vi.runAllTimersAsync();
      expect(store.getState().composerAnchor).toEqual(anchor);
      expect(store.getState().composerSaving).toBe(false);
    });

    it("refuses a second save while one is in flight", async () => {
      store.getState().actions.openComposer(anchor, undefined);
      void store.getState().actions.saveComment(anchor, "one");
      void store.getState().actions.saveComment(anchor, "two");
      expect(session.saveComment).toHaveBeenCalledTimes(1);
      await vi.runAllTimersAsync();
    });

    it("rejects an empty body and keeps the composer open", () => {
      store.getState().actions.openComposer(anchor, undefined);
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

  describe("re-anchor mode", () => {
    it("arms quietly: the banner shows it, the toast stays empty", () => {
      store.getState().actions.startReanchor("draft-1", undefined);
      flushAnnounce();
      expect(store.getState().reanchorDraftId).toBe("draft-1");
      expect(store.getState().toast).toBe("");
      expect(store.getState().liveMessage).toBe(
        "Pick the lines this draft belongs on.",
      );
    });

    it("cancels and announces the cancel", () => {
      store.getState().actions.startReanchor("draft-1", undefined);
      store.getState().actions.cancelReanchor();
      flushAnnounce();
      expect(store.getState().reanchorDraftId).toBeNull();
      expect(store.getState().liveMessage).toBe("Re-anchoring cancelled.");
    });

    it("drops a live line selection when arming", () => {
      store.setState({
        lineSelection: {
          chunkId: "chunk-a",
          file: "src/a.ts",
          side: DiffSides.NEW,
          startLine: 10,
          endLine: 10,
          rowIds: ["row-1"],
        },
      });
      store.getState().actions.startReanchor("draft-1", undefined);
      expect(store.getState().lineSelection).toBeNull();
    });

    it("announces the read-only reason instead of arming", () => {
      store.getState().actions.startReanchor("draft-1", "Historical revision.");
      flushAnnounce();
      expect(store.getState().reanchorDraftId).toBeNull();
      expect(store.getState().toast).toBe("Historical revision.");
    });

    it("pressing the same draft's control again cancels", () => {
      store.getState().actions.startReanchor("draft-1", undefined);
      store.getState().actions.startReanchor("draft-1", undefined);
      expect(store.getState().reanchorDraftId).toBeNull();
    });

    it("refuses a placement whose path is over the bound and stays armed", () => {
      const longPath = {
        ...anchor,
        file: "x".repeat(RequestBounds.PATH_LENGTH + 1),
      };
      store.getState().actions.startReanchor("draft-1", undefined);
      store.getState().actions.openComposer(longPath, undefined);
      flushAnnounce();
      expect(session.reanchorComment).not.toHaveBeenCalled();
      expect(store.getState().reanchorDraftId).toBe("draft-1");
      expect(store.getState().composerAnchor).toBeNull();
      expect(store.getState().toast).toBe(
        "That file's path is too long to hold a comment. Pick lines in another file, or cancel re-anchoring.",
      );
    });

    it("leaves the live region alone when nothing is armed", () => {
      store.getState().actions.cancelReanchor();
      flushAnnounce();
      expect(store.getState().liveMessage).toBe("");
    });
  });

  describe("line selection", () => {
    const picked = {
      chunkId: "chunk-a",
      file: "src/a.ts",
      side: DiffSides.NEW,
      startLine: 12,
      endLine: 20,
      rowIds: ["chunk-a:3", "chunk-a:4"],
    };

    it("starts empty and holds the lines a reader picks", () => {
      expect(store.getState().lineSelection).toBeNull();
      store.getState().actions.selectLines(picked);
      expect(store.getState().lineSelection).toEqual(picked);
    });

    it("a pick in another chunk replaces the selection whole", () => {
      const { actions } = store.getState();
      actions.selectLines(picked);
      const elsewhere = {
        ...picked,
        chunkId: "chunk-b",
        rowIds: ["chunk-b:0"],
      };
      actions.selectLines(elsewhere);
      expect(store.getState().lineSelection).toEqual(elsewhere);
    });

    it("clears on request and survives the composer closing", () => {
      const { actions } = store.getState();
      actions.selectLines(picked);
      actions.openComposer(anchor, undefined);
      actions.cancelComposer();
      expect(store.getState().lineSelection).toEqual(picked);
      actions.clearLineSelection();
      expect(store.getState().lineSelection).toBeNull();
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

    it("announceQuietly clears then sets the hidden message, toast untouched", () => {
      store.getState().actions.announceQuietly("Line 9 selected.");
      expect(store.getState().liveMessage).toBe("");
      flushAnnounce();
      expect(store.getState().liveMessage).toBe("Line 9 selected.");
      expect(store.getState().toast).toBe("");
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
