// @vitest-environment jsdom
// Inline post-now transport: expected failure statuses are result kinds the
// own-draft flow renders — never throws for those; a malformed 2xx throws typed
// (contract violation). jsdom is for the settled-queue suite below.
import { describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../../data/apiFetch";

vi.mock("../../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

import { act, renderHook } from "@testing-library/react";

import { apiFetch, ApiError } from "../../../data/apiFetch";
import type { ReviewComment } from "../../review/utils/comments";
import { createReviewSessionStore } from "../../review/session";
import {
  applySettledPosts,
  beginInFlightPost,
  commitPostedComment,
  endInFlightPost,
  postInlineComment,
  recordFailedPost,
  recordPostNotice,
  useInFlightPosts,
  type PostCommentPayload,
} from "./postComment";

const apiFetchMock = vi.mocked(apiFetch);

const PAYLOAD: PostCommentPayload = {
  commitId: "a".repeat(40),
  path: "src/index.ts",
  line: 12,
  side: "RIGHT",
  body: "post now",
};

describe("postInlineComment", () => {
  it("posts the payload to the PR comments endpoint and returns both ids", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ commentId: 3_600_000_001, reviewId: 42 }), {
        status: 201,
      }),
    );
    await expect(postInlineComment("42", 7, PAYLOAD)).resolves.toEqual({
      kind: "posted",
      commentId: 3_600_000_001,
      reviewId: 42,
    });
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/repos/42/pulls/7/comments",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(PAYLOAD),
      },
    );
  });

  it("returns posted without reviewId when GitHub assigned none", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ commentId: 5 }), { status: 201 }),
    );
    await expect(postInlineComment("42", 7, PAYLOAD)).resolves.toEqual({
      kind: "posted",
      commentId: 5,
    });
  });

  it("maps expected failures to result kinds (incl. 409 stale)", async () => {
    for (const [status, kind] of [
      [401, "unauthorized"],
      [404, "not-found"],
      [409, "stale"],
      [400, "invalid"],
      [502, "upstream"],
    ] as const) {
      apiFetchMock.mockResolvedValue(new Response("{}", { status }));
      await expect(postInlineComment("42", 7, PAYLOAD)).resolves.toEqual({
        kind,
      });
    }
  });

  it("maps both wire 409 codes to stale (the production path)", async () => {
    for (const code of ["pr-changed-since-read", "pr-rewritten-since-read"]) {
      apiFetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: "conflict", code }), {
          status: 409,
        }),
      );
      await expect(postInlineComment("42", 7, PAYLOAD)).resolves.toEqual({
        kind: "stale",
      });
    }
  });

  it("throws typed on a malformed 2xx", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ nope: true }), { status: 201 }),
    );
    await expect(postInlineComment("42", 7, PAYLOAD)).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});

// ---------------------------------------------------------------------------
// commitPostedComment + applySettledPosts — the posted-branch effects.
// ---------------------------------------------------------------------------

function draft(id: string): ReviewComment {
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
    body: "post me now",
    status: "draft",
    collapsed: false,
  };
}

describe("commitPostedComment + applySettledPosts", () => {
  it("the drain applies flip + announce exactly once", () => {
    // The LIVE flip and the announcement go through the settled queue so both
    // land on whichever mount is live at settle time — and, with the closure
    // announcing nothing directly, the no-remount case announces EXACTLY once.
    const briefId = "db:commit:7:base:head";
    commitPostedComment(briefId, "a", 555, "Comment posted to GitHub.");

    const markCommentsSubmitted = vi.fn();
    const recordSubmittedReview = vi.fn();
    const announce = vi.fn();
    applySettledPosts(
      briefId,
      { markCommentsSubmitted, recordSubmittedReview },
      announce,
    );
    expect(markCommentsSubmitted).toHaveBeenCalledWith(["a"]);
    expect(recordSubmittedReview).toHaveBeenCalledWith(555);
    expect(announce).toHaveBeenCalledExactlyOnceWith(
      "Comment posted to GitHub.",
    );

    // The queue was cleared: a re-run (strict-mode double effect, later
    // in-flight changes) applies and announces nothing twice.
    applySettledPosts(
      briefId,
      { markCommentsSubmitted, recordSubmittedReview },
      announce,
    );
    expect(markCommentsSubmitted).toHaveBeenCalledTimes(1);
    expect(recordSubmittedReview).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("commits without a review id (GitHub assigned none)", () => {
    const briefId = "db:noreview:7:base:head";
    commitPostedComment(briefId, "a", undefined, "posted");

    const recordSubmittedReview = vi.fn();
    applySettledPosts(
      briefId,
      { markCommentsSubmitted: vi.fn(), recordSubmittedReview },
      vi.fn(),
    );
    expect(recordSubmittedReview).not.toHaveBeenCalled();
  });

  it("failure-settle-after-remount: the indeterminate copy reaches the fresh mount", () => {
    // The closure's captured announce targets the ORPHANED mount (a no-op), so
    // a remount-mid-flight failure would surface nothing while the Post button
    // silently re-enables — inviting the double-posting retry the indeterminate
    // copy warns against. The failure must ride the queue and announce on the
    // drain.
    const briefId = "db:remount-fail:7:base:head";
    const failedCopy =
      "Something went wrong posting this comment — it may or may not have posted. Check the pull request on GitHub before retrying.";
    recordFailedPost(briefId, "a", failedCopy);

    const markCommentsSubmitted = vi.fn();
    const announce = vi.fn();
    applySettledPosts(
      briefId,
      { markCommentsSubmitted, recordSubmittedReview: vi.fn() },
      announce,
    );
    // Announced on the LIVE mount, exactly once — and no store flip: the
    // draft stays a draft on a failed post.
    expect(announce).toHaveBeenCalledExactlyOnceWith(failedCopy);
    expect(markCommentsSubmitted).not.toHaveBeenCalled();

    // Drained: a later effect run announces nothing again.
    applySettledPosts(
      briefId,
      { markCommentsSubmitted, recordSubmittedReview: vi.fn() },
      announce,
    );
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("settle-after-remount: the drain flips the FRESH store and the next flush keeps the flip", () => {
    // The settling closure captured the ORPHANED old store. The remounted
    // store loaded the session BEFORE the settle, so without the drain it
    // would still say draft — Submit would re-ship the comment, and the Post
    // button would re-enable on it (double-post).
    const briefId = "db:remount-settle:7:base:head";
    const store = createReviewSessionStore({
      dispositions: {},
      dominants: {},
      reclassifiedGroups: new Set(),
      reviewedChunks: new Set(),
      reviewComments: [draft("a")],
      reviewOutcome: "comment",
      submittedReviewIds: [],
    });

    // The surviving closure settles against the orphaned mount.
    commitPostedComment(briefId, "a", 777, "Comment posted to GitHub.");

    // The drain effect on the CURRENT mount applies the flip to ITS store
    // and announces through ITS live region.
    const announce = vi.fn();
    applySettledPosts(
      briefId,
      {
        markCommentsSubmitted: (ids) =>
          store.getState().actions.markCommentsSubmitted(ids),
        recordSubmittedReview: (reviewId) =>
          store.getState().actions.recordSubmittedReview(reviewId),
      },
      announce,
    );
    // Status flipped (the Post affordance never renders on `submitted`) and
    // the "yours" reconciliation join key restored; the success copy reached
    // the fresh mount.
    expect(store.getState().reviewComments[0]?.status).toBe("submitted");
    expect(store.getState().submittedReviewIds).toContain(777);
    expect(announce).toHaveBeenCalledExactlyOnceWith(
      "Comment posted to GitHub.",
    );
  });

  it("drain is best-effort: a throwing store never propagates", () => {
    // A live-store failure in the drain logs and never surfaces as an error
    // (the comment IS on GitHub) — and the announcement still goes out.
    const briefId = "db:throw:7:base:head";
    commitPostedComment(briefId, "a", 555, "posted");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const announce = vi.fn();
    expect(() =>
      applySettledPosts(
        briefId,
        {
          markCommentsSubmitted: () => {
            throw new Error("store gone");
          },
          recordSubmittedReview: vi.fn(),
        },
        announce,
      ),
    ).not.toThrow();
    expect(consoleError).toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith("posted");
    consoleError.mockRestore();
  });

  it("suppressed entries (batch owns messaging): flips apply, nothing announced", () => {
    // Batch-initiated posts queue with a NULL copy — the drain applies every
    // store flip (durable + live) but announces nothing, so the batch's summary
    // toast stays the last live-region write.
    const briefId = "db:batch-silent:7:base:head";
    commitPostedComment(briefId, "a", 222, null);
    recordFailedPost(briefId, "b", null);

    const markCommentsSubmitted = vi.fn();
    const recordSubmittedReview = vi.fn();
    const announce = vi.fn();
    applySettledPosts(
      briefId,
      { markCommentsSubmitted, recordSubmittedReview },
      announce,
    );
    // The flips still land…
    expect(markCommentsSubmitted).toHaveBeenCalledWith(["a"]);
    expect(recordSubmittedReview).toHaveBeenCalledWith(222);
    // …but the drain announces nothing: the batch owns messaging.
    expect(announce).not.toHaveBeenCalled();
  });

  it("a batch notice is announced LAST (after per-comment entries) and drained once", () => {
    // The mark-ready batch's failure summary rides the settled queue like every
    // failure, so a remount-mid-batch cannot silently drop it — and the drain
    // orders it after every per-comment entry, making it the live-region write
    // that survives.
    const briefId = "db:batch-notice:7:base:head";
    const summary =
      "Posted 1 of 3. One comment may or may not have posted — check GitHub before retrying. The PR was NOT marked ready.";
    commitPostedComment(briefId, "a", 333, null);
    recordFailedPost(briefId, "b", null);
    recordPostNotice(briefId, summary);

    const markCommentsSubmitted = vi.fn();
    const announce = vi.fn();
    applySettledPosts(
      briefId,
      { markCommentsSubmitted, recordSubmittedReview: vi.fn() },
      announce,
    );
    // Flips applied; the SUMMARY is the only (and last) announcement.
    expect(markCommentsSubmitted).toHaveBeenCalledWith(["a"]);
    expect(announce).toHaveBeenCalledExactlyOnceWith(summary);

    // Drained: a later effect run announces nothing again.
    applySettledPosts(
      briefId,
      { markCommentsSubmitted, recordSubmittedReview: vi.fn() },
      announce,
    );
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("recordPostNotice wakes subscribers even without an in-flight transition", () => {
    // A guard-path batch failure never touches the registry — the notice must
    // still notify (fresh snapshot reference), or the drain effect would bail
    // and the summary would sit queued until an unrelated post settled.
    const briefId = "db:notice-wake:7:base:head";
    const rendered = renderHook(({ id }) => useInFlightPosts(id), {
      initialProps: { id: briefId },
    });
    const before = rendered.result.current;
    act(() => {
      recordPostNotice(briefId, "summary");
    });
    // A new snapshot reference: React re-renders and the drain effect re-runs.
    expect(rendered.result.current).not.toBe(before);
    rendered.unmount();
    // Clean the queue so later suites see no leftover notice.
    applySettledPosts(
      briefId,
      { markCommentsSubmitted: vi.fn(), recordSubmittedReview: vi.fn() },
      vi.fn(),
    );
  });

  it("concurrent-settle tick: the failure warning wins the last live-region read", () => {
    // Two drafts settling in one drain — one posted, one failed — collapse to a
    // single clear-then-set live-region read. The failure's indeterminate
    // "check GitHub" copy must be the LAST announced, never overwritten by the
    // co-settling success. Recorded success-first to prove reordering, not
    // arrival order, decides.
    const briefId = "db:concurrent:9:base:head";
    const failedCopy =
      "Something went wrong posting this comment — it may or may not have posted. Check the pull request on GitHub before retrying.";
    commitPostedComment(briefId, "a", 111, "Comment posted to GitHub.");
    recordFailedPost(briefId, "b", failedCopy);

    const announce = vi.fn();
    applySettledPosts(
      briefId,
      { markCommentsSubmitted: vi.fn(), recordSubmittedReview: vi.fn() },
      announce,
    );
    // Both announced; the failure warning is last (the read that survives).
    expect(announce).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenLastCalledWith(failedCopy);
  });
});

// ---------------------------------------------------------------------------
// In-flight post registry — module-level, survives remounts.
// ---------------------------------------------------------------------------

describe("in-flight post registry", () => {
  it("survives a same-tab remount: a fresh subscription sees the unsettled post", () => {
    // BriefView is keyed by briefId, so a historical-revision round trip
    // remounts the screen with the SAME briefId while the fetch closure
    // survives. Per-mount state would reset (lockdown + submit block gone → the
    // review re-ships the still-draft comment); the module registry must not.
    const briefId = "db:remount:7:base:head";
    const first = renderHook(({ id }) => useInFlightPosts(id), {
      initialProps: { id: briefId },
    });
    expect(first.result.current.size).toBe(0);

    act(() => {
      expect(beginInFlightPost(briefId, "comment-a")).toBe(true);
    });
    expect(first.result.current.has("comment-a")).toBe(true);

    // The remount: old subscription torn down, a FRESH component subscribes
    // with the same briefId while the post is still unresolved.
    first.unmount();
    const remounted = renderHook(({ id }) => useInFlightPosts(id), {
      initialProps: { id: briefId },
    });
    expect(remounted.result.current.has("comment-a")).toBe(true);

    // The surviving closure settles: the remounted subscription clears.
    act(() => {
      endInFlightPost(briefId, "comment-a");
    });
    expect(remounted.result.current.size).toBe(0);
    remounted.unmount();
  });

  it("is the synchronous re-entrancy gate: a duplicate begin is refused", () => {
    const briefId = "db:reentry:7:base:head";
    expect(beginInFlightPost(briefId, "comment-a")).toBe(true);
    expect(beginInFlightPost(briefId, "comment-a")).toBe(false);
    // Distinct drafts still post concurrently.
    expect(beginInFlightPost(briefId, "comment-b")).toBe(true);
    endInFlightPost(briefId, "comment-a");
    endInFlightPost(briefId, "comment-b");
    // Settled → re-postable (a failed post keeps the draft and may retry).
    expect(beginInFlightPost(briefId, "comment-a")).toBe(true);
    endInFlightPost(briefId, "comment-a");
  });

  it("scopes the view per brief: another brief's posts are invisible", () => {
    const briefId = "db:scope:7:base:head";
    const other = "db:scope:8:base:head";
    beginInFlightPost(other, "comment-x");
    const rendered = renderHook(({ id }) => useInFlightPosts(id), {
      initialProps: { id: briefId },
    });
    expect(rendered.result.current.size).toBe(0);
    act(() => {
      endInFlightPost(other, "comment-x");
    });
    rendered.unmount();
  });
});
