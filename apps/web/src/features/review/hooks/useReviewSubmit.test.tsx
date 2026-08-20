// @vitest-environment jsdom
// Facade-hook tests for the DB submit flow: pending gate, blocked reason,
// result-kind copy (posted / degraded / fail-closed reload / re-login), and
// the draft flip on success only.
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type * as SessionModule from "../session";

vi.mock("../session", async (importOriginal) => {
  const actual = await importOriginal<typeof SessionModule>();
  return { ...actual, markSnapshotCommentsSubmitted: vi.fn() };
});

import type { CommentAnchor, ReviewComment } from "../utils/comments";
import type { Receipt } from "../utils/receipt";
import { markSnapshotCommentsSubmitted } from "../session";
import type { SubmitReviewResult } from "../utils/submit";
import { useReviewSubmit, type UseReviewSubmitInput } from "./useReviewSubmit";

const durableFlipMock = vi.mocked(markSnapshotCommentsSubmitted);

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
  chunkId: "chunk-a",
  file: "src/a.ts",
  side: "new",
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
    status: "draft",
    collapsed: false,
  };
}

function setup(overrides: Partial<UseReviewSubmitInput> = {}) {
  const markSubmitted = vi.fn();
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
    receipt: RECEIPT,
    getReviewComment: () => "",
    consumeReviewComment,
    markSubmitted,
    recordSubmittedReview,
    announce,
    invalidateConversation,
    closeSubmit,
    resetOutcome,
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
  };
}

describe("useReviewSubmit", () => {
  it("is unavailable without an injected action (local demo path)", () => {
    const { rendered } = setup({ action: undefined });
    expect(rendered.result.current.available).toBe(false);
  });

  it("blocks a neutral comment submit with no drafts, with a reachable reason", () => {
    const { rendered, action } = setup({ outcome: "comment", comments: [] });
    expect(rendered.result.current.blockedReasonWith("")).toMatch(
      /at least one comment/i,
    );
    act(() => rendered.result.current.submit());
    expect(action).not.toHaveBeenCalled();
  });

  it("blocks submit while blocked externally, unblocking when the reason clears", () => {
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
      commentsDegraded: false,
    });
    act(() => rendered.result.current.submit());
    expect(action).toHaveBeenCalledTimes(1);
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
      commentsDegraded: false,
    });

    act(() => rendered.result.current.submit());
    expect(rendered.result.current.pending).toBe(true);
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));

    expect(action).toHaveBeenCalledWith({
      outcome: "approve",
      body: expect.stringContaining("Reviewed with MergeBrief"),
      comments: [draft("a")],
    });
    expect(markSubmitted).toHaveBeenCalledWith(["a"]);
    // Durable flip too — the provider may already be unmounted by now; the
    // approve verdict is spent, so the durable write also resets the outcome.
    expect(durableFlipMock).toHaveBeenCalledWith(
      "db:1:7:base:head",
      ["a"],
      true,
      5,
    );
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
      commentsDegraded: true,
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
    // at all — the failure this pins is silence, not the wrong words.
    expect(rendered.result.current.error).toMatch(
      /no longer points at any code/i,
    );
    expect(rendered.result.current.error).toMatch(/nothing was posted/i);
    expect(markSubmitted).not.toHaveBeenCalled();
    expect(closeSubmit).not.toHaveBeenCalled();
  });

  it("ignores a second click while pending (double-post guard)", async () => {
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
      release?.({ kind: "submitted", reviewId: 5, commentsDegraded: false }),
    );
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));
  });

  it("spends the verdict on success — outcome resets to comment", async () => {
    const { rendered, action, resetOutcome } = setup({ outcome: "approve" });
    action.mockResolvedValue({
      kind: "submitted",
      reviewId: 5,
      commentsDegraded: false,
    });
    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));
    expect(resetOutcome).toHaveBeenCalledTimes(1);
  });

  it("keeps a comment outcome as-is on success (nothing to spend)", async () => {
    const { rendered, action, resetOutcome } = setup({
      outcome: "comment",
      comments: [draft("a")],
    });
    action.mockResolvedValue({
      kind: "submitted",
      reviewId: 5,
      commentsDegraded: false,
    });
    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));
    expect(resetOutcome).not.toHaveBeenCalled();
    expect(durableFlipMock).toHaveBeenLastCalledWith(
      "db:1:7:base:head",
      ["a"],
      false,
      5,
    );
  });

  it("still reports success when local persistence throws (review IS posted)", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { rendered, action, announce, closeSubmit } = setup();
    action.mockResolvedValue({
      kind: "submitted",
      reviewId: 5,
      commentsDegraded: false,
    });
    durableFlipMock.mockImplementationOnce(() => {
      throw new Error("QuotaExceededError");
    });

    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));

    // GitHub created the review — a sessionStorage failure must not render
    // the "nothing was posted" retry prompt.
    expect(rendered.result.current.error).toBeNull();
    expect(announce).toHaveBeenCalledWith(expect.stringMatching(/posted/i));
    expect(closeSubmit).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
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
      commentsDegraded: true,
    });
    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));
    expect(rendered.result.current.note).not.toBeNull();

    action.mockResolvedValueOnce({
      kind: "submitted",
      reviewId: 6,
      commentsDegraded: false,
    });
    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));
    expect(rendered.result.current.note).toBeNull();
  });

  it("announces failures through the page live region (drawer may be closed)", async () => {
    const { rendered, action, announce } = setup();
    action.mockResolvedValue({ kind: "rewritten" });
    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));
    expect(announce).toHaveBeenCalledWith(
      expect.stringMatching(/rewritten since you read it/i),
    );
  });

  it("maps a thrown transport error to indeterminate copy (may have posted)", async () => {
    const { rendered, action } = setup();
    action.mockRejectedValue(new Error("boom"));

    act(() => rendered.result.current.submit());
    await waitFor(() => expect(rendered.result.current.pending).toBe(false));

    // A throw can land AFTER the POST reached GitHub — the copy must not
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
      commentsDegraded: false,
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
      commentsDegraded: false,
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

  it("re-reads the draft at click time — a keystroke after the render unblocks", async () => {
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
      commentsDegraded: false,
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

  it("evaluates blockedReasonWith per caller draft (editing-surface contract)", () => {
    // The editing surface subscribes to the raw text and re-derives the
    // disabled state per keystroke — without the owning screen re-rendering.
    const { rendered } = setup({ outcome: "comment", comments: [] });
    expect(
      rendered.result.current.blockedReasonWith("typed just now"),
    ).toBeUndefined();
    expect(rendered.result.current.blockedReasonWith("")).toMatch(
      /at least one comment/i,
    );
  });

  it("mentions the own-PR rule only for verdict outcomes on upstream rejection", async () => {
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
});
