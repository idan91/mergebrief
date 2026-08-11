// @vitest-environment jsdom
import { appI18n } from "../../../../i18n/I18nProvider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommentAnchor } from "../../utils/comments";
import {
  createReviewFlowStore,
  type ReviewFlowPosture,
  type ReviewFlowSessionActions,
  type ReviewFlowStore,
} from "./store";

const anchor: CommentAnchor = {
  chunkId: "chunk-a",
  file: "src/a.ts",
  side: "new",
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
    saveComment: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
    toggleComment: vi.fn(),
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

  describe("composer", () => {
    it("opens at the anchor when writable", () => {
      store.getState().actions.openComposer(anchor);
      expect(store.getState().composerAnchor).toEqual(anchor);
    });

    it("announces the read-only reason instead of opening", () => {
      store.setState({ composerDisabledReason: "Historical revision." });
      store.getState().actions.openComposer(anchor);
      expect(store.getState().composerAnchor).toBeNull();
      flushAnnounce();
      expect(store.getState().toast).toBe("Historical revision.");
    });

    it("saves a trimmed draft, closes the composer, and announces", () => {
      store.getState().actions.openComposer(anchor);
      store.getState().actions.saveComment(anchor, "  looks wrong  ");
      expect(session.saveComment).toHaveBeenCalledWith({
        anchor,
        body: "looks wrong",
        status: "draft",
        collapsed: false,
      });
      expect(store.getState().composerAnchor).toBeNull();
      flushAnnounce();
      expect(store.getState().toast).toBe(
        "Draft comment added to this review.",
      );
    });

    it("rejects an empty body and keeps the composer open", () => {
      store.getState().actions.openComposer(anchor);
      store.getState().actions.saveComment(anchor, "   ");
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
      // Capture-at-initiation: a mid-flight edit is user content —
      // the success sweep must not silently drop it.
      store.getState().actions.setReviewComment("Solid change.");
      store.getState().actions.setReviewComment("Solid change, but check X.");
      store.getState().actions.consumeReviewComment("Solid change.");
      expect(store.getState().reviewComment).toBe("Solid change, but check X.");
    });
  });
});
