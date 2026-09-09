// Server-backed threads win on exact review-id joins while local records retain links.
// Matching drafts must become submitted so a missed local flip cannot resurrect a post.
import { describe, expect, it } from "vitest";
import type { ReviewComment } from "@web/features/review/utils";
import type { ConversationComment, ConversationThread } from "../types";
import type { Mutable } from "types";
import {
  demotedSubmittedCommentIds,
  reconcileOwnComments,
} from "./ownComments";

function localComment(overrides: {
  id: string;
  file?: string;
  side?: "old" | "new";
  startLine?: number;
  endLine?: number;
  body?: string;
  status?: "draft" | "submitted";
}): ReviewComment {
  return {
    id: overrides.id,
    anchor: {
      chunkId: "c1",
      file: overrides.file ?? "src/a.ts",
      side: overrides.side ?? "new",
      startLine: overrides.startLine ?? 11,
      endLine: overrides.endLine ?? 11,
      rowIds: ["c1:3"],
      selectedText: "added line",
    },
    body: overrides.body ?? "my note",
    status: overrides.status ?? "submitted",
    collapsed: false,
  };
}

function serverThread(overrides: {
  rootCommentId: number;
  path?: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
  reviewId?: number;
  body?: string;
}): ConversationThread {
  const rootComment: Mutable<ConversationComment> = {
    commentId: overrides.rootCommentId,
    author: { login: "me", isBot: false },
    body: overrides.body ?? "my note",
    createdAt: "2026-07-07T10:00:00Z",
    url: `https://example.test/c/${overrides.rootCommentId}`,
  };

  if (overrides.reviewId !== undefined)
    rootComment.reviewId = overrides.reviewId;

  return {
    rootCommentId: overrides.rootCommentId,
    path: overrides.path ?? "src/a.ts",
    line: overrides.line ?? 11,
    side: overrides.side ?? "RIGHT",
    subjectType: "LINE",
    isResolved: false,
    isOutdated: false,
    comments: [rootComment],
    hasMoreComments: false,
  };
}

const MY_REVIEW = 4_647_663_464;

describe("reconcileOwnComments", () => {
  it("links submitted locals to own threads by recorded review id", () => {
    const result = reconcileOwnComments(
      [localComment({ id: "local-1" })],
      [
        serverThread({ rootCommentId: 9001, reviewId: MY_REVIEW }),
        serverThread({
          rootCommentId: 9002,
          reviewId: 111,
          line: 12,
          body: "someone else",
        }),
      ],
      [MY_REVIEW],
    );
    expect([...result.ownThreadIds]).toEqual([9001]);
    expect(result.pointers.get("local-1")).toBe(9001);
    expect(result.resurrectedDraftIds).toEqual([]);
  });

  it("joins on path, line and side with old-side mapped to LEFT", () => {
    const result = reconcileOwnComments(
      [
        localComment({ id: "left-1", side: "old", endLine: 20 }),
        localComment({ id: "right-1", side: "new", endLine: 11 }),
      ],
      [
        serverThread({
          rootCommentId: 9001,
          side: "LEFT",
          line: 20,
          reviewId: MY_REVIEW,
        }),
        serverThread({
          rootCommentId: 9002,
          side: "RIGHT",
          line: 11,
          reviewId: MY_REVIEW,
        }),
      ],
      [MY_REVIEW],
    );
    expect(result.pointers.get("left-1")).toBe(9001);
    expect(result.pointers.get("right-1")).toBe(9002);
  });

  it("breaks a same-anchor collision by body", () => {
    const result = reconcileOwnComments(
      [
        localComment({ id: "a", body: "first note" }),
        localComment({ id: "b", body: "second note" }),
      ],
      [
        serverThread({
          rootCommentId: 9001,
          reviewId: MY_REVIEW,
          body: "second note",
        }),
        serverThread({
          rootCommentId: 9002,
          reviewId: MY_REVIEW,
          body: "first note",
        }),
      ],
      [MY_REVIEW],
    );
    expect(result.pointers.get("a")).toBe(9002);
    expect(result.pointers.get("b")).toBe(9001);
  });

  it("marks matching local drafts submitted after a missed flip", () => {
    // The submit landed on GitHub but the sessionStorage flip was lost
    // (navigate-away mid-request). After the first refetch the server-backed
    // record wins: the draft must NOT re-ship on the next submit.
    const result = reconcileOwnComments(
      [localComment({ id: "ghost-draft", status: "draft" })],
      [serverThread({ rootCommentId: 9001, reviewId: MY_REVIEW })],
      [MY_REVIEW],
    );
    expect(result.resurrectedDraftIds).toEqual(["ghost-draft"]);
    expect(result.pointers.get("ghost-draft")).toBe(9001);
  });

  it("prioritizes exact body matches over earlier fallback candidates", () => {
    // Two locals share one anchor; only ONE server thread exists and its
    // body exactly matches the LATER draft. The earlier local must not
    // steal it via fallback, the exact match wins, so the posted draft
    // flips (missed-flip closure) and the unposted one stays a draft.
    const result = reconcileOwnComments(
      [
        localComment({
          id: "unposted",
          status: "draft",
          body: "different note",
        }),
        localComment({ id: "posted", status: "draft", body: "exact note" }),
      ],
      [
        serverThread({
          rootCommentId: 9001,
          reviewId: MY_REVIEW,
          body: "exact note",
        }),
      ],
      [MY_REVIEW],
    );
    expect(result.pointers.get("posted")).toBe(9001);
    expect(result.pointers.has("unposted")).toBe(false);
    expect(result.resurrectedDraftIds).toEqual(["posted"]);
  });

  it("requires an exact side to join a thread", () => {
    const sideless: ConversationThread = {
      ...serverThread({ rootCommentId: 9001, reviewId: MY_REVIEW }),
    };
    const stripped = { ...sideless };
    delete (stripped as { side?: unknown }).side;
    const result = reconcileOwnComments(
      [localComment({ id: "draft-1", status: "draft" })],
      [stripped],
      [MY_REVIEW],
    );
    // The thread is still OWN (review-id join) but no local record joins it.
    expect(result.ownThreadIds.has(9001)).toBe(true);
    expect(result.pointers.size).toBe(0);
    expect(result.resurrectedDraftIds).toEqual([]);
  });

  it("never claims foreign threads and never pointers unmatched locals", () => {
    const result = reconcileOwnComments(
      [localComment({ id: "local-1", endLine: 99 })],
      [serverThread({ rootCommentId: 9001, reviewId: 222 })],
      [MY_REVIEW],
    );
    expect(result.ownThreadIds.size).toBe(0);
    expect(result.pointers.size).toBe(0);
    expect(result.resurrectedDraftIds).toEqual([]);
  });

  it("keeps a draft untouched when no own thread matches its anchor", () => {
    const result = reconcileOwnComments(
      [localComment({ id: "still-draft", status: "draft", endLine: 42 })],
      [serverThread({ rootCommentId: 9001, reviewId: MY_REVIEW, line: 11 })],
      [MY_REVIEW],
    );
    expect(result.resurrectedDraftIds).toEqual([]);
    expect(result.pointers.has("still-draft")).toBe(false);
  });

  it("returns empty results when no review ids were recorded", () => {
    const result = reconcileOwnComments(
      [localComment({ id: "local-1" })],
      [serverThread({ rootCommentId: 9001, reviewId: MY_REVIEW })],
      [],
    );
    expect(result.ownThreadIds.size).toBe(0);
    expect(result.pointers.size).toBe(0);
  });
});

describe("demotedSubmittedCommentIds display half", () => {
  it("demotes a submitted record whose own server thread renders", () => {
    expect(
      demotedSubmittedCommentIds(
        [localComment({ id: "local-1", status: "submitted" })],
        [serverThread({ rootCommentId: 9001, reviewId: MY_REVIEW })],
      ),
    ).toEqual(new Set(["local-1"]));
  });

  it("never demotes drafts, and keeps unmatched submitted records", () => {
    expect(
      demotedSubmittedCommentIds(
        [
          localComment({ id: "draft-1", status: "draft" }),
          localComment({ id: "other-line", status: "submitted", endLine: 40 }),
        ],
        [serverThread({ rootCommentId: 9001, reviewId: MY_REVIEW })],
      ),
    ).toEqual(new Set());
  });

  it("demotes nothing before own threads load", () => {
    expect(
      demotedSubmittedCommentIds(
        [localComment({ id: "local-1", status: "submitted" })],
        [],
      ),
    ).toEqual(new Set());
  });
});
