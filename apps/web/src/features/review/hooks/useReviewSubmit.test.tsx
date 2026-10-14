// @vitest-environment jsdom
// Facade-hook tests for the DB submit flow: pending gate, blocked reason,
// result-kind copy (posted / degraded / fail-closed reload / re-login), and
// the draft flip on success only.
import { act, renderHook, waitFor } from "@testing-library/react";
import { RequestBounds } from "contract";
import { describe, expect, it, vi } from "vitest";

import { type CommentAnchor, type ReviewComment } from "../utils/comments";
import type { Receipt } from "../utils/receipt";
import type { SessionDraftComment } from "../session/serverState";
import {
  createReviewFlowStore,
  type ReviewFlowSessionActions,
  type ReviewFlowStore,
} from "../session/flow/store";
import { buildSignatureLine, foldDraftsIntoBody } from "../utils/submit";
import type { SubmitReviewResult } from "../utils/types";
import { useReviewSubmit, type UseReviewSubmitInput } from "./useReviewSubmit";
import {
  CommentAnchorKinds,
  DiffSides,
  DraftCommentStatuses,
} from "types/comments";

const RECEIPT: Receipt = {
  subject: { repo: "octo/hello", number: 7, sha: "c".repeat(40) },
  progress: { reviewedChunks: 3, chunkTotal: 4, flagTotal: 2 },
  counts: { addressed: 1, dismissed: 0, open: 1 },
  addressed: [],
  dismissed: [],
  open: [],
  comments: [],
  reclassifiedCount: 0,
};

const ANCHOR: CommentAnchor = {
  kind: CommentAnchorKinds.LINE,
  chunkId: "chunk-a",
  file: "src/a.ts",
  side: DiffSides.NEW,
  startLine: 3,
  endLine: 3,
  rowIds: ["chunk-a:0"],
  selectedText: "x",
};

function draft(id: string): ReviewComment {
  return {
    id,
    anchor: ANCHOR,
    body: "note",
    status: DraftCommentStatuses.DRAFT,
    collapsed: false,
  };
}

function makeDraftWithBody(body: string): ReviewComment {
  return { ...draft("a"), body };
}

function stubFlowSession(): ReviewFlowSessionActions {
  return {
    saveComment: vi.fn(() => Promise.resolve(true)),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
    toggleComment: vi.fn(),
    reanchorComment: vi.fn(),
  };
}

function makeFlowStore(): ReviewFlowStore {
  return createReviewFlowStore(stubFlowSession(), (key) => key);
}

function setup(overrides: Partial<UseReviewSubmitInput> = {}) {
  const writeEvents: string[] = [];
  function trackWrite<Value>(write: () => Promise<Value>): Promise<Value> {
    writeEvents.push("start");
    return write().finally(() => writeEvents.push("end"));
  }
  const markSubmitted = vi.fn(() => {
    writeEvents.push("flip");
  });
  const recordSubmittedReview = vi.fn();
  const announce = vi.fn();
  const invalidateConversation = vi.fn();
  const closeSubmit = vi.fn();
  const resetOutcome = vi.fn();
  const consumeReviewComment = vi.fn();
  const action = vi.fn<(draftInput: unknown) => Promise<SubmitReviewResult>>();
  const input: UseReviewSubmitInput = {
    action,
    briefId: "db:1:7:base:head",
    outcome: "approve",
    comments: [draft("a")],
    unplacedDrafts: [],
    receipt: RECEIPT,
    getReviewComment: () => "",
    consumeReviewComment,
    markSubmitted,
    recordSubmittedReview,
    announce,
    invalidateConversation,
    closeSubmit,
    resetOutcome,
    trackWrite,
    flowStore: makeFlowStore(),
    ...overrides,
  };
  const rendered = renderHook(
    (props: UseReviewSubmitInput) => useReviewSubmit(props),
    { initialProps: input },
  );
  return {
    rendered,
    input,
    action,
    markSubmitted,
    recordSubmittedReview,
    announce,
    invalidateConversation,
    closeSubmit,
    resetOutcome,
    consumeReviewComment,
    writeEvents,
  };
}

describe("useReviewSubmit", () => {
  it("is unavailable without an injected action", () => {
    const { rendered } = setup({ action: undefined });
    expect(rendered.result.current.available).toBe(false);
  });

  it("blocks a comment submit with no drafts and a reachable reason", () => {
    const { rendered, action } = setup({ outcome: "comment", comments: [] });
    expect(rendered.result.current.blockedReasonWith("")).toMatch(
      /at least one comment/i,
    );
    act(() => rendered.result.current.submit());
    expect(action).not.toHaveBeenCalled();
  });

  it("never sends a submit while no outcome is picked", () => {
    const { rendered, input, action } = setup({ outcome: undefined });
    expect(rendered.result.current.blockedReasonWith("")).toMatch(
      /pick an outcome/i,
    );
    act(() => rendered.result.current.submit());
    expect(action).not.toHaveBeenCalled();

    rendered.rerender({ ...input, outcome: "approve" });
    action.mockResolvedValue({
      kind: "submitted",
      reviewId: 1,
      commentsFolded: 0,
      commentsTotal: 1,
    });
    act(() => rendered.result.current.submit());
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "approve" }),
    );
  });

  it("blocks submit while blocked, then unblocks when it clears", () => {
    // Same-tab re-ship window: a post-now still in flight when the submit
    // machinery mounts would ship the still-draft comment, so submit must
    // both surface the reason AND refuse to run until it clears.
    const reason = "A comment is still posting to GitHub — wait.";
    const { rendered, input, action } = setup({ blockedExternally: reason });
    expect(rendered.result.current.blockedReasonWith("")).toBe(reason);
    act(() => rendered.result.current.submit());
    expect(action).not.toHaveBeenCalled();

    // The post settled: the block clears and submit proceeds.
    rendered.rerender({ ...input, blockedExternally: undefined });
    expect(rendered.result.current.blockedReasonWith("")).toBeUndefined();
    action.mockResolvedValue({
      kind: "submitted",
      reviewId: 1,
      commentsFolded: 0,
      commentsTotal: 1,
    });
    act(() => rendered.result.current.submit());
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("stays a session write until the submitted drafts flip", async () => {
    const { rendered, action, writeEvents } = setup();
    action.mockResolvedValue({
      kind: "submitted",
      reviewId: 5,
      commentsFolded: 0,
      commentsTotal: 1,
    });

    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));

    expect(writeEvents).toEqual(["start", "flip", "end"]);
  });

  it("submits the signature-line body and flips drafts on success", async () => {
    const {
      rendered,
      action,
      markSubmitted,
      recordSubmittedReview,
      announce,
      invalidateConversation,
      closeSubmit,
    } = setup();
    action.mockResolvedValue({
      kind: "submitted",
      reviewId: 5,
      commentsFolded: 0,
      commentsTotal: 1,
    });

    act(() => rendered.result.current.submit());
    expect(rendered.result.current.pending).toBe(true);
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));

    expect(action).toHaveBeenCalledWith({
      outcome: "approve",
      body: expect.stringContaining("Reviewed with MergeBrief"),
    });
    expect(markSubmitted).toHaveBeenCalledWith(["a"]);
    expect(recordSubmittedReview).toHaveBeenCalledWith(5);
    expect(closeSubmit).toHaveBeenCalledTimes(1);
    // The review is live: the conversation refetches so the posted comments
    // render as their GitHub threads.
    expect(invalidateConversation).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(expect.stringMatching(/posted/i));
    expect(rendered.result.current.error).toBeNull();
  });

  it("keeps a persistent degradation note when anchors were folded", async () => {
    const { rendered, action } = setup();
    action.mockResolvedValue({
      kind: "submitted",
      reviewId: 5,
      commentsFolded: 1,
      commentsTotal: 2,
    });

    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));

    expect(rendered.result.current.note).toMatch(
      /folded into the review body/i,
    );
  });

  it("renders the fail-closed reload copy on rewritten, drafts untouched", async () => {
    const { rendered, action, markSubmitted, closeSubmit } = setup();
    action.mockResolvedValue({ kind: "rewritten" });

    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));

    expect(rendered.result.current.error).toMatch(
      /rewritten since you read it/i,
    );
    expect(rendered.result.current.error).toMatch(/reload/i);
    expect(markSubmitted).not.toHaveBeenCalled();
    expect(closeSubmit).not.toHaveBeenCalled();
  });

  it("renders the re-place copy on an orphaned draft, drafts untouched", async () => {
    const { rendered, action, markSubmitted, closeSubmit } = setup();
    action.mockResolvedValue({ kind: "orphaned-draft" });

    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));

    // An unhandled kind leaves `error` null and the reviewer with no message
    // at all. The failure this pins is silence, not the wrong words.
    expect(rendered.result.current.error).toMatch(
      /no longer points at any code/i,
    );
    expect(rendered.result.current.error).toMatch(/nothing was posted/i);
    expect(markSubmitted).not.toHaveBeenCalled();
    expect(closeSubmit).not.toHaveBeenCalled();
  });

  it("ignores a second click while pending", async () => {
    const { rendered, action } = setup();
    let release: ((value: SubmitReviewResult) => void) | undefined;
    action.mockImplementation(
      () =>
        new Promise<SubmitReviewResult>((resolve) => {
          release = resolve;
        }),
    );

    act(() => rendered.result.current.submit());
    act(() => rendered.result.current.submit());
    expect(action).toHaveBeenCalledTimes(1);

    act(() =>
      release?.({
        kind: "submitted",
        reviewId: 5,
        commentsFolded: 0,
        commentsTotal: 1,
      }),
    );
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));
  });

  it("spends the verdict on success and resets to comment", async () => {
    const { rendered, action, resetOutcome } = setup({ outcome: "approve" });
    action.mockResolvedValue({
      kind: "submitted",
      reviewId: 5,
      commentsFolded: 0,
      commentsTotal: 1,
    });
    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));
    expect(resetOutcome).toHaveBeenCalledTimes(1);
  });

  it("keeps a comment outcome as-is on success", async () => {
    const { rendered, action, resetOutcome } = setup({
      outcome: "comment",
      comments: [draft("a")],
    });
    action.mockResolvedValue({
      kind: "submitted",
      reviewId: 5,
      commentsFolded: 0,
      commentsTotal: 1,
    });
    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));
    expect(resetOutcome).not.toHaveBeenCalled();
  });

  it("does not spend the verdict on failure", async () => {
    const { rendered, action, resetOutcome } = setup({ outcome: "approve" });
    action.mockResolvedValue({ kind: "rewritten" });
    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));
    expect(resetOutcome).not.toHaveBeenCalled();
  });

  it("clears a previous degradation note when a later submit anchors cleanly", async () => {
    const { rendered, action } = setup();
    action.mockResolvedValueOnce({
      kind: "submitted",
      reviewId: 5,
      commentsFolded: 1,
      commentsTotal: 2,
    });
    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));
    expect(rendered.result.current.note).not.toBeNull();

    action.mockResolvedValueOnce({
      kind: "submitted",
      reviewId: 6,
      commentsFolded: 0,
      commentsTotal: 1,
    });
    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));
    expect(rendered.result.current.note).toBeNull();
  });

  it("announces failures through the page live region", async () => {
    const { rendered, action, announce } = setup();
    action.mockResolvedValue({ kind: "rewritten" });
    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));
    expect(announce).toHaveBeenCalledWith(
      expect.stringMatching(/rewritten since you read it/i),
    );
  });

  it("maps a thrown transport error to indeterminate copy", async () => {
    const { rendered, action } = setup();
    action.mockRejectedValue(new Error("boom"));

    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));

    // A throw can land AFTER the POST reached GitHub. The copy must not
    // claim nothing was posted, and must point at GitHub before a retry.
    expect(rendered.result.current.error).toMatch(
      /may or may not have posted/i,
    );
    expect(rendered.result.current.error).toMatch(/check the pull request/i);
    expect(rendered.result.current.error).not.toContain("boom");
  });

  it("ships the review comment above the signature, separator-fenced", async () => {
    const { rendered, action } = setup({
      getReviewComment: () => "Solid change.",
    });
    action.mockResolvedValue({
      kind: "submitted",
      reviewId: 5,
      commentsFolded: 0,
      commentsTotal: 1,
    });
    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringMatching(
          /^Solid change\.\n\n---\n\nReviewed with MergeBrief/,
        ),
      }),
    );
  });

  it("consumes the review comment with the text captured at click time", async () => {
    const { rendered, action, consumeReviewComment } = setup({
      getReviewComment: () => "Solid change.",
    });
    action.mockResolvedValue({
      kind: "submitted",
      reviewId: 5,
      commentsFolded: 0,
      commentsTotal: 1,
    });
    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));
    expect(consumeReviewComment).toHaveBeenCalledWith("Solid change.");
  });

  it("does not consume the review comment on failure", async () => {
    const { rendered, action, consumeReviewComment } = setup({
      getReviewComment: () => "Solid change.",
    });
    action.mockResolvedValue({ kind: "rewritten" });
    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));
    expect(consumeReviewComment).not.toHaveBeenCalled();
  });

  it("unblocks a neutral comment submit when a review comment is present", () => {
    const { rendered } = setup({ outcome: "comment", comments: [] });
    expect(
      rendered.result.current.blockedReasonWith("Looks fine overall."),
    ).toBeUndefined();
  });

  it("re-reads the draft at click so a later keystroke unblocks", async () => {
    // The owning screen renders with an empty draft (blocked), then the user
    // types in the editing surface (store-only change, no screen re-render)
    // and clicks Submit: the guard must re-read the getter, not the value
    // captured at render.
    let draftText = "";
    const { rendered, action } = setup({
      outcome: "comment",
      comments: [],
      getReviewComment: () => draftText,
    });
    expect(rendered.result.current.blockedReasonWith(draftText)).toMatch(
      /at least one comment/i,
    );
    action.mockResolvedValue({
      kind: "submitted",
      reviewId: 5,
      commentsFolded: 0,
      commentsTotal: 1,
    });
    draftText = "typed after render";
    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringMatching(/^typed after render\n\n---\n\n/),
      }),
    );
  });

  it("counts the signature line toward the fold", () => {
    const signature = buildSignatureLine(RECEIPT, 1);
    const emptyFold = foldDraftsIntoBody(
      "",
      [makeDraftWithBody("")],
      [],
    ).length;
    const unsignedFill = RequestBounds.BODY_LENGTH - emptyFold;
    const signedFill = unsignedFill - signature.length - "\n\n".length;

    const unsigned = setup({
      comments: [makeDraftWithBody("x".repeat(unsignedFill))],
    });
    const signed = setup({
      comments: [makeDraftWithBody("x".repeat(signedFill))],
    });

    expect(unsigned.rendered.result.current.blockedReasonWith("")).toMatch(
      /too large/i,
    );
    expect(
      signed.rendered.result.current.blockedReasonWith(""),
    ).toBeUndefined();
  });

  it("blocks when only the unplaced draft tips the fold", () => {
    const signature = buildSignatureLine(RECEIPT, 1);
    const emptyFold = foldDraftsIntoBody(
      signature,
      [makeDraftWithBody("")],
      [],
    ).length;
    const filling = makeDraftWithBody(
      "x".repeat(RequestBounds.BODY_LENGTH - emptyFold),
    );
    const unplaced: SessionDraftComment = {
      id: "gone",
      filePath: "src/gone.ts",
      kind: CommentAnchorKinds.FILE,
      body: "left the brief",
      status: DraftCommentStatuses.DRAFT,
    };

    const placedOnly = setup({ comments: [filling] });
    const withUnplaced = setup({
      comments: [filling],
      unplacedDrafts: [unplaced],
    });

    expect(
      placedOnly.rendered.result.current.blockedReasonWith(""),
    ).toBeUndefined();
    expect(withUnplaced.rendered.result.current.blockedReasonWith("")).toMatch(
      /too large/i,
    );
    act(() => withUnplaced.rendered.result.current.submit());
    expect(withUnplaced.action).not.toHaveBeenCalled();
  });

  it("counts unplaced drafts in the signature line", async () => {
    const unplaced: SessionDraftComment = {
      id: "gone",
      filePath: "src/gone.ts",
      kind: CommentAnchorKinds.FILE,
      body: "left the brief",
      status: DraftCommentStatuses.DRAFT,
    };
    const { rendered, action } = setup({ unplacedDrafts: [unplaced] });
    action.mockResolvedValue({
      kind: "submitted",
      reviewId: 9,
      commentsFolded: 0,
      commentsTotal: 2,
    });

    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));

    expect(action).toHaveBeenCalledWith({
      outcome: "approve",
      body: buildSignatureLine(RECEIPT, 2),
    });
  });

  it("flips the unplaced drafts with the placed ones on success", async () => {
    const unplaced: SessionDraftComment = {
      id: "gone",
      filePath: "src/gone.ts",
      kind: CommentAnchorKinds.FILE,
      body: "left the brief",
      status: DraftCommentStatuses.DRAFT,
    };
    const { rendered, action, markSubmitted } = setup({
      unplacedDrafts: [unplaced],
    });
    action.mockResolvedValue({
      kind: "submitted",
      reviewId: 9,
      commentsFolded: 0,
      commentsTotal: 2,
    });

    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));

    expect(markSubmitted).toHaveBeenCalledWith(["a", "gone"]);
  });

  it("counts and flips a draft of an unknown anchor the route posts", async () => {
    const held: SessionDraftComment = {
      id: "held",
      filePath: "src/a.ts",
      kind: "unknown",
      body: "anchored where this bundle cannot read",
      status: DraftCommentStatuses.DRAFT,
    };
    const { rendered, action, markSubmitted } = setup({
      unplacedDrafts: [held],
    });
    action.mockResolvedValue({
      kind: "submitted",
      reviewId: 9,
      commentsFolded: 0,
      commentsTotal: 2,
    });

    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));

    expect(action).toHaveBeenCalledWith({
      outcome: "approve",
      body: buildSignatureLine(RECEIPT, 2),
    });
    expect(markSubmitted).toHaveBeenCalledWith(["a", "held"]);
  });

  it("evaluates blockedReasonWith per caller draft", () => {
    // The editing surface subscribes to the raw text and re-derives the
    // disabled state per keystroke, without the owning screen re-rendering.
    const { rendered } = setup({ outcome: "comment", comments: [] });
    expect(
      rendered.result.current.blockedReasonWith("typed just now"),
    ).toBeUndefined();
    expect(rendered.result.current.blockedReasonWith("")).toMatch(
      /at least one comment/i,
    );
  });

  it("renders the finish-on-GitHub copy on a held pending review", async () => {
    const { rendered, action, markSubmitted } = setup();
    action.mockResolvedValue({ kind: "pending-review-held" });
    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));
    expect(rendered.result.current.error).toMatch(/unsubmitted review/i);
    expect(markSubmitted).not.toHaveBeenCalled();
  });

  it("renders the indeterminate copy when the proxy times out", async () => {
    const { rendered, action } = setup({ outcome: "approve" });
    action.mockResolvedValue({ kind: "indeterminate" });
    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));
    expect(rendered.result.current.error).toMatch(
      /may or may not have posted/i,
    );
  });

  it("mentions the own-PR rule only for verdicts on rejection", async () => {
    const { rendered, action } = setup({ outcome: "approve" });
    action.mockResolvedValue({ kind: "upstream" });
    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));
    expect(rendered.result.current.error).toMatch(/your own pull request/i);

    const neutral = setup({ outcome: "comment", comments: [draft("a")] });
    neutral.action.mockResolvedValue({ kind: "upstream" });
    act(() => neutral.rendered.result.current.submit());
    await waitFor(() =>
      expect(neutral.rendered.result.current.pending).toBe(false),
    );
    expect(neutral.rendered.result.current.error).not.toMatch(
      /your own pull request/i,
    );
  });

  it("starts a new revision without the previous revision's failure", async () => {
    const { rendered, input, action } = setup();
    action.mockResolvedValue({ kind: "rewritten" });

    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));
    expect(rendered.result.current.error).toMatch(/reload/i);

    rendered.rerender({
      ...input,
      briefId: "db:1:7:base:next",
      flowStore: makeFlowStore(),
    });
    expect(rendered.result.current.error).toBeNull();
  });

  it("shows a failure that settles after a return to the same revision", async () => {
    const { rendered, input, action } = setup();
    let settle: (result: SubmitReviewResult) => void = () => {};
    action.mockReturnValue(
      new Promise<SubmitReviewResult>((resolve) => {
        settle = resolve;
      }),
    );

    act(() => rendered.result.current.submit());
    rendered.rerender({
      ...input,
      briefId: "db:1:7:base:next",
      flowStore: makeFlowStore(),
    });
    rendered.rerender({ ...input, flowStore: makeFlowStore() });
    await act(async () => settle({ kind: "rewritten" }));

    expect(rendered.result.current.error).toMatch(/reload/i);
  });
});
