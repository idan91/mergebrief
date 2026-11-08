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
import { ComposerStateKinds } from "./types";
import {
  getComposerAnchor,
  getComposerHost,
  getReanchorDraftId,
  isComposerSaving,
} from "./utils";

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

const otherAnchor: CommentAnchor = {
  ...anchor,
  startLine: 12,
  endLine: 12,
  rowIds: ["row-3"],
  selectedText: "return a;",
};

interface DeferredSave {
  promise: Promise<boolean>;
  resolve: (saved: boolean) => void;
}

function makeDeferredSave(): DeferredSave {
  let resolve: (saved: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function sessionMock(): ReviewFlowSessionActions {
  return {
    saveComment: vi.fn(() => Promise.resolve(true)),
    updateComment: vi.fn(() => Promise.resolve(true)),
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
    it("opens at the anchor in the host that picked the rows", () => {
      store.getState().actions.openComposer(anchor, undefined, "chunk-b");
      expect(store.getState().composer).toEqual({
        kind: ComposerStateKinds.OPEN,
        anchor,
        host: "chunk-b",
      });
      store.getState().actions.cancelComposer();
      expect(store.getState().composer.kind).toBe(ComposerStateKinds.CLOSED);
    });

    it("announces the read-only reason instead of opening", () => {
      store
        .getState()
        .actions.openComposer(anchor, "Historical revision.", anchor.chunkId);
      expect(store.getState().composer.kind).toBe(ComposerStateKinds.CLOSED);
      flushAnnounce();
      expect(store.getState().toast).toBe("Historical revision.");
    });

    it("closes the composer on write SUCCESS, not on click", async () => {
      store.getState().actions.openComposer(anchor, undefined, anchor.chunkId);
      void store.getState().actions.saveComment(anchor, "  looks wrong  ");
      expect(session.saveComment).toHaveBeenCalledWith({
        anchor,
        body: "looks wrong",
        status: DraftCommentStatuses.DRAFT,
        collapsed: false,
      });
      expect(store.getState().composer.kind).toBe(ComposerStateKinds.SAVING);
      await vi.runAllTimersAsync();
      expect(store.getState().composer.kind).toBe(ComposerStateKinds.CLOSED);
      flushAnnounce();
      expect(store.getState().toast).toBe(
        "Draft comment added to this review.",
      );
    });

    it("leaves the composer open when the write fails", async () => {
      session.saveComment = vi.fn(() => Promise.resolve(false));
      store = createReviewFlowStore(session, appI18n.t);
      store.getState().actions.openComposer(anchor, undefined, anchor.chunkId);
      void store.getState().actions.saveComment(anchor, "looks wrong");
      await vi.runAllTimersAsync();
      expect(store.getState().composer).toEqual({
        kind: ComposerStateKinds.OPEN,
        anchor,
        host: anchor.chunkId,
      });
    });

    it("reopens the composer when the write throws", async () => {
      session.saveComment = vi.fn(() => Promise.reject(new Error("network")));
      store = createReviewFlowStore(session, appI18n.t);
      store.getState().actions.openComposer(anchor, undefined, anchor.chunkId);
      await expect(
        store.getState().actions.saveComment(anchor, "looks wrong"),
      ).rejects.toThrow("network");
      expect(store.getState().composer.kind).toBe(ComposerStateKinds.OPEN);
    });

    it("refuses a second save while one is in flight", async () => {
      store.getState().actions.openComposer(anchor, undefined, anchor.chunkId);
      void store.getState().actions.saveComment(anchor, "one");
      void store.getState().actions.saveComment(anchor, "two");
      expect(session.saveComment).toHaveBeenCalledTimes(1);
      await vi.runAllTimersAsync();
    });

    it("refuses a cancel while the save is in flight and says why", () => {
      session.saveComment = vi.fn(() => new Promise<boolean>(() => {}));
      store = createReviewFlowStore(session, appI18n.t);
      store.getState().actions.openComposer(anchor, undefined, anchor.chunkId);
      void store.getState().actions.saveComment(anchor, "one");
      store.getState().actions.cancelComposer();
      flushAnnounce();
      expect(store.getState().composer.kind).toBe(ComposerStateKinds.SAVING);
      expect(store.getState().toast).toBe(
        "A comment is still saving. Try again once it lands.",
      );
    });

    it("announces why a row pick is ignored while saving", () => {
      session.saveComment = vi.fn(() => new Promise<boolean>(() => {}));
      store = createReviewFlowStore(session, appI18n.t);
      store.getState().actions.openComposer(anchor, undefined, anchor.chunkId);
      void store.getState().actions.saveComment(anchor, "one");
      store.getState().actions.openComposer(otherAnchor, undefined, "chunk-a");
      flushAnnounce();
      expect(getComposerAnchor(store.getState().composer)).toBe(anchor);
      expect(store.getState().toast).toBe(
        "A comment is still saving. Try again once it lands.",
      );
    });

    it("keeps a reopened composer open when an older save lands", async () => {
      const first = makeDeferredSave();
      session.saveComment = vi.fn(() => first.promise);
      store = createReviewFlowStore(session, appI18n.t);
      const { actions } = store.getState();
      actions.openComposer(anchor, undefined, anchor.chunkId);
      const pending = actions.saveComment(anchor, "one");
      actions.dismissComposer();
      actions.openComposer(otherAnchor, undefined, "chunk-a");
      first.resolve(true);
      await pending;
      expect(store.getState().composer).toEqual({
        kind: ComposerStateKinds.OPEN,
        anchor: otherAnchor,
        host: "chunk-a",
      });
    });

    it("refuses to reopen lines whose dismissed save is in flight", async () => {
      const first = makeDeferredSave();
      session.saveComment = vi.fn(() => first.promise);
      store = createReviewFlowStore(session, appI18n.t);
      const { actions } = store.getState();
      actions.openComposer(anchor, undefined, anchor.chunkId);
      const pending = actions.saveComment(anchor, "one");
      actions.dismissComposer();

      actions.openComposer({ ...anchor, rowIds: [] }, undefined, "chunk-a");
      flushAnnounce();
      expect(store.getState().composer.kind).toBe(ComposerStateKinds.CLOSED);
      expect(store.getState().toast).toBe(
        "A comment is still saving. Try again once it lands.",
      );

      first.resolve(false);
      await pending;
      actions.openComposer(anchor, undefined, anchor.chunkId);
      expect(store.getState().composer.kind).toBe(ComposerStateKinds.OPEN);
    });

    it("opens the same file under another header mid-save", () => {
      session.saveComment = vi.fn(() => new Promise<boolean>(() => {}));
      store = createReviewFlowStore(session, appI18n.t);
      const { actions } = store.getState();
      const fileAnchor: CommentAnchor = {
        kind: CommentAnchorKinds.FILE,
        file: "src/a.ts",
      };
      actions.openComposer(fileAnchor, undefined, "chunk-a");
      void actions.saveComment(fileAnchor, "one");
      actions.dismissComposer();

      actions.openComposer(fileAnchor, undefined, "chunk-b");

      expect(getComposerHost(store.getState().composer)).toBe("chunk-b");
    });

    it("places a carried draft on lines whose dismissed save is in flight", () => {
      session.saveComment = vi.fn(() => new Promise<boolean>(() => {}));
      session.reanchorComment = vi.fn(() => true);
      store = createReviewFlowStore(session, appI18n.t);
      const { actions } = store.getState();
      actions.openComposer(anchor, undefined, anchor.chunkId);
      void actions.saveComment(anchor, "one");
      actions.dismissComposer();
      actions.startReanchor("draft-1", undefined);

      actions.openComposer(anchor, undefined, anchor.chunkId);

      expect(session.reanchorComment).toHaveBeenCalledWith("draft-1", anchor);
    });

    it("lets a new composer save while a dismissed save is in flight", async () => {
      const first = makeDeferredSave();
      const second = makeDeferredSave();
      session.saveComment = vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      store = createReviewFlowStore(session, appI18n.t);
      const { actions } = store.getState();
      actions.openComposer(anchor, undefined, anchor.chunkId);
      const firstSave = actions.saveComment(anchor, "one");
      actions.dismissComposer();
      actions.openComposer(otherAnchor, undefined, "chunk-a");
      const secondSave = actions.saveComment(otherAnchor, "two");
      expect(session.saveComment).toHaveBeenCalledTimes(2);

      first.resolve(true);
      await firstSave;
      expect(isComposerSaving(store.getState().composer)).toBe(true);
      second.resolve(true);
      await secondSave;
      expect(store.getState().composer.kind).toBe(ComposerStateKinds.CLOSED);
    });

    it("dismisses a composer once the last surface hosting it is gone", async () => {
      const { actions } = store.getState();
      const release = actions.holdComposerHost(anchor.kind, "chunk-a");
      actions.openComposer(anchor, undefined, "chunk-a");

      release();
      await Promise.resolve();

      expect(store.getState().composer.kind).toBe(ComposerStateKinds.CLOSED);
    });

    it("keeps the composer when its host remounts in the same tick", async () => {
      const { actions } = store.getState();
      const release = actions.holdComposerHost(anchor.kind, "chunk-a");
      actions.openComposer(anchor, undefined, "chunk-a");

      release();
      actions.holdComposerHost(anchor.kind, "chunk-a");
      await Promise.resolve();

      expect(store.getState().composer.kind).toBe(ComposerStateKinds.OPEN);
    });

    it("keeps a file composer when its card's diff table leaves", async () => {
      const { actions } = store.getState();
      const fileAnchor: CommentAnchor = {
        kind: CommentAnchorKinds.FILE,
        file: "src/a.ts",
      };
      actions.holdComposerHost(CommentAnchorKinds.FILE, "chunk-a");
      const releaseTable = actions.holdComposerHost(anchor.kind, "chunk-a");
      actions.openComposer(fileAnchor, undefined, "chunk-a");

      releaseTable();
      await Promise.resolve();

      expect(store.getState().composer.kind).toBe(ComposerStateKinds.OPEN);
    });

    it("rejects an empty body and keeps the composer open", () => {
      store.getState().actions.openComposer(anchor, undefined, anchor.chunkId);
      void store.getState().actions.saveComment(anchor, "   ");
      expect(session.saveComment).not.toHaveBeenCalled();
      expect(store.getState().composer.kind).toBe(ComposerStateKinds.OPEN);
      flushAnnounce();
      expect(store.getState().toast).toBe("Comment cannot be empty.");
    });

    it("updates through the session actions with trimmed body", async () => {
      await store.getState().actions.updateComment("id-1", " edited ");
      expect(session.updateComment).toHaveBeenCalledWith("id-1", "edited");
    });

    it("rejects an empty update and answers false", async () => {
      const updated = await store.getState().actions.updateComment("id-1", " ");
      expect(updated).toBe(false);
      expect(session.updateComment).not.toHaveBeenCalled();
    });

    it("announces an update only after it lands", async () => {
      const landing = makeDeferredSave();
      session.updateComment = vi.fn(() => landing.promise);
      store = createReviewFlowStore(session, appI18n.t);
      const pending = store.getState().actions.updateComment("id-1", "edited");
      flushAnnounce();
      expect(store.getState().toast).toBe("");

      landing.resolve(true);
      expect(await pending).toBe(true);
      flushAnnounce();
      expect(store.getState().toast).toBe("Draft comment updated.");
    });

    it("answers false and stays quiet when the update fails", async () => {
      session.updateComment = vi.fn(() => Promise.resolve(false));
      store = createReviewFlowStore(session, appI18n.t);
      const updated = await store
        .getState()
        .actions.updateComment("id-1", "edited");
      flushAnnounce();
      expect(updated).toBe(false);
      expect(store.getState().toast).toBe("");
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
      expect(getReanchorDraftId(store.getState().composer)).toBe("draft-1");
      expect(store.getState().toast).toBe("");
      expect(store.getState().liveMessage).toBe(
        "Pick the lines this draft belongs on.",
      );
    });

    it("cancels and announces the cancel", () => {
      store.getState().actions.startReanchor("draft-1", undefined);
      store.getState().actions.cancelReanchor();
      flushAnnounce();
      expect(getReanchorDraftId(store.getState().composer)).toBeUndefined();
      expect(store.getState().liveMessage).toBe("Re-anchoring cancelled.");
    });

    it("starting re-anchor closes an open file composer", () => {
      store
        .getState()
        .actions.openComposer(
          { kind: CommentAnchorKinds.FILE, file: "src/a.ts" },
          undefined,
          "chunk-a",
        );
      store.getState().actions.startReanchor("draft-1", undefined);
      expect(getComposerAnchor(store.getState().composer)).toBeUndefined();
      expect(getReanchorDraftId(store.getState().composer)).toBe("draft-1");
    });

    it("refuses to arm while a save is in flight and says why", () => {
      session.saveComment = vi.fn(() => new Promise<boolean>(() => {}));
      store = createReviewFlowStore(session, appI18n.t);
      store.getState().actions.openComposer(anchor, undefined, anchor.chunkId);
      void store.getState().actions.saveComment(anchor, "one");
      store.getState().actions.startReanchor("draft-1", undefined);
      flushAnnounce();
      expect(isComposerSaving(store.getState().composer)).toBe(true);
      expect(store.getState().toast).toBe(
        "A comment is still saving. Try again once it lands.",
      );
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
      expect(getReanchorDraftId(store.getState().composer)).toBeUndefined();
      expect(store.getState().toast).toBe("Historical revision.");
    });

    it("pressing the same draft's control again cancels", () => {
      store.getState().actions.startReanchor("draft-1", undefined);
      store.getState().actions.startReanchor("draft-1", undefined);
      expect(getReanchorDraftId(store.getState().composer)).toBeUndefined();
    });

    it("refuses a placement whose path is over the bound and stays armed", () => {
      const longPath = {
        ...anchor,
        file: "x".repeat(RequestBounds.PATH_LENGTH + 1),
      };
      store.getState().actions.startReanchor("draft-1", undefined);
      store.getState().actions.openComposer(longPath, undefined, "chunk-a");
      flushAnnounce();
      expect(session.reanchorComment).not.toHaveBeenCalled();
      expect(getReanchorDraftId(store.getState().composer)).toBe("draft-1");
      expect(store.getState().toast).toBe(
        "That file's path is too long to hold a comment. Pick lines in another file, or cancel re-anchoring.",
      );
    });

    it("a file comment ends re-anchoring and leaves the draft in place", () => {
      const fileAnchor: CommentAnchor = {
        kind: CommentAnchorKinds.FILE,
        file: "src/b.ts",
      };
      store.getState().actions.startReanchor("draft-1", undefined);
      store.getState().actions.openComposer(fileAnchor, undefined, "chunk-b");
      flushAnnounce();
      expect(session.reanchorComment).not.toHaveBeenCalled();
      expect(store.getState().composer).toEqual({
        kind: ComposerStateKinds.OPEN,
        anchor: fileAnchor,
        host: "chunk-b",
      });
      expect(store.getState().liveMessage).toBe("Re-anchoring cancelled.");
      expect(store.getState().toast).toBe("");
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

    it("clears on request and survives the composer closing", () => {
      const { actions } = store.getState();
      actions.selectLines(picked);
      actions.openComposer(anchor, undefined, anchor.chunkId);
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
