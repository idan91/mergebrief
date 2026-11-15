// @vitest-environment jsdom
import type { PrLevelCommentView } from "contract";
import type { ReviewVerdictState } from "types/conversation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildThreadComposer,
  filterForLanding,
  holdsThread,
  listHeadSummaryParts,
  markSmoothScroll,
  shouldRelandInPlace,
  type ThreadComposerInput,
} from "./utils";
import type {
  ConversationReview,
  ConversationThread,
  PrConversation,
} from "../../types";
import { DEFAULT_CONVERSATION_FILTER } from "../../utils/filter";
import { ThreadPlacementKinds } from "../../utils/anchor";
import { DigestRowKinds, type DigestThreadRow } from "../../utils/digest";
import type { ConversationPlan } from "./types";

function review(
  reviewId: number,
  state: ReviewVerdictState,
  body = `body ${reviewId}`,
): ConversationReview {
  return {
    reviewId,
    author: { login: "octocat", isBot: false },
    state,
    body,
    url: `https://github.com/o/r/pull/1#pullrequestreview-${reviewId}`,
  };
}

function thread(rootCommentId: number, isResolved = false): ConversationThread {
  return {
    rootCommentId,
    path: "src/a.ts",
    line: 10,
    side: "RIGHT",
    subjectType: "LINE",
    isResolved,
    isOutdated: false,
    comments: [
      {
        commentId: rootCommentId,
        author: { login: "octocat", isBot: false },
        body: "note",
        createdAt: "2026-08-01T00:00:00Z",
        url: `https://github.com/o/r/pull/1#discussion_r${rootCommentId}`,
      },
    ],
    hasMoreComments: false,
  };
}

function makeAuthoredThread(rootCommentId: number, login: string) {
  const base = thread(rootCommentId);
  const comments = base.comments.map((comment) => ({
    ...comment,
    author: { login, isBot: false },
  }));
  return { ...base, comments };
}

function prComment(commentId: number): PrLevelCommentView {
  return {
    commentId,
    author: { login: "octocat", isBot: false },
    body: "general",
    createdAt: "2026-08-01T00:00:00Z",
    url: `https://github.com/o/r/pull/1#issuecomment-${commentId}`,
  };
}

function buildConversation(
  parts: Partial<
    Pick<PrConversation, "threads" | "reviews" | "prComments">
  > = {},
): PrConversation {
  return {
    threads: parts.threads ?? [],
    reviews: parts.reviews ?? [],
    prComments: parts.prComments ?? [],
    hasMoreThreads: false,
    hasMoreReviews: false,
    hasMorePrComments: false,
  };
}

describe("listHeadSummaryParts", () => {
  it("returns no parts for an empty conversation", () => {
    expect(listHeadSummaryParts(buildConversation(), 0)).toEqual([]);
  });

  it("omits zero parts, a body-only review never reads 0 threads", () => {
    const conversation = buildConversation({
      reviews: [review(1, "COMMENTED", "LGTM")],
    });
    expect(listHeadSummaryParts(conversation, 0)).toEqual([
      { i18nKey: "conversation.summaryReviews", count: 1 },
    ]);
  });

  it("ignores empty-bodied COMMENTED envelopes", () => {
    const conversation = buildConversation({
      reviews: [review(1, "COMMENTED", "  ")],
      threads: [thread(11, true)],
    });
    expect(listHeadSummaryParts(conversation, 0)).toEqual([
      { i18nKey: "conversation.summaryThreadsCounted", count: 1, open: 0 },
    ]);
  });

  it("lists every present kind in order, threads with their open count", () => {
    const conversation = buildConversation({
      reviews: [review(1, "APPROVED"), review(2, "CHANGES_REQUESTED")],
      prComments: [prComment(21)],
      threads: [thread(11), thread(12, true)],
    });
    expect(listHeadSummaryParts(conversation, 0)).toEqual([
      { i18nKey: "conversation.summaryReviews", count: 2 },
      { i18nKey: "conversation.summaryComments", count: 1 },
      { i18nKey: "conversation.summaryThreadsCounted", count: 2, open: 1 },
    ]);
  });

  it("ends with what is new since the brief, when anything is", () => {
    const conversation = buildConversation({ threads: [thread(11)] });
    expect(listHeadSummaryParts(conversation, 2)).toEqual([
      { i18nKey: "conversation.summaryThreadsCounted", count: 1, open: 1 },
      { i18nKey: "conversation.summaryAfterBrief", count: 2 },
    ]);
  });
});

describe("shouldRelandInPlace", () => {
  it("relands only when the jump changes neither revision nor thread", () => {
    const sameSpot = {
      currentHeadSha: "a".repeat(40),
      anchorSha: "a".repeat(40),
      focusThreadId: 7,
      threadId: 7,
    };

    expect(shouldRelandInPlace(sameSpot)).toBe(true);
    const otherSha = "b".repeat(40);
    expect(shouldRelandInPlace({ ...sameSpot, anchorSha: otherSha })).toBe(
      false,
    );
    expect(shouldRelandInPlace({ ...sameSpot, threadId: 8 })).toBe(false);
    expect(shouldRelandInPlace({ ...sameSpot, focusThreadId: undefined })).toBe(
      false,
    );
  });
});

describe("markSmoothScroll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function stubSmoothScrolls() {
    const endSmoothScroll = vi.fn();
    const beginSmoothScroll = vi.fn(() => endSmoothScroll);
    return { beginSmoothScroll, endSmoothScroll };
  }

  it("marks the scroll in flight until it ends", () => {
    const { beginSmoothScroll, endSmoothScroll } = stubSmoothScrolls();

    markSmoothScroll(beginSmoothScroll);
    expect(beginSmoothScroll).toHaveBeenCalledOnce();
    expect(endSmoothScroll).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("scrollend"));
    window.dispatchEvent(new Event("scrollend"));
    expect(endSmoothScroll).toHaveBeenCalledOnce();
  });

  it("keeps the mark while scroll events keep arriving", () => {
    const { beginSmoothScroll, endSmoothScroll } = stubSmoothScrolls();

    markSmoothScroll(beginSmoothScroll);
    vi.advanceTimersByTime(100);
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(100);
    expect(endSmoothScroll).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(endSmoothScroll).toHaveBeenCalledOnce();
  });

  it("ends the mark when no scroll event arrives", () => {
    const { beginSmoothScroll, endSmoothScroll } = stubSmoothScrolls();

    markSmoothScroll(beginSmoothScroll);
    vi.advanceTimersByTime(200);
    expect(endSmoothScroll).toHaveBeenCalledOnce();
  });

  it("ends the mark when the reader takes over", () => {
    const { beginSmoothScroll, endSmoothScroll } = stubSmoothScrolls();

    markSmoothScroll(beginSmoothScroll);
    window.dispatchEvent(new Event("wheel"));
    vi.advanceTimersByTime(200);
    expect(endSmoothScroll).toHaveBeenCalledOnce();
  });
});

describe("filterForLanding", () => {
  const aliceOnly = {
    ...DEFAULT_CONVERSATION_FILTER,
    reviewers: new Set(["alice"]),
  };
  const conversation = buildConversation({
    threads: [makeAuthoredThread(1, "alice"), makeAuthoredThread(2, "bob")],
  });

  function listThreadIds(result: PrConversation): number[] {
    return result.threads.map((kept) => kept.rootCommentId);
  }

  it("returns the filtered conversation when no thread is targeted", () => {
    const kept = filterForLanding(conversation, aliceOnly, undefined);

    expect(listThreadIds(kept)).toEqual([1]);
  });

  it("keeps a target the filter already lets through, once", () => {
    const kept = filterForLanding(conversation, aliceOnly, 1);

    expect(listThreadIds(kept)).toEqual([1]);
  });

  it("appends a target the filter drops", () => {
    const kept = filterForLanding(conversation, aliceOnly, 2);

    expect(listThreadIds(kept)).toEqual([1, 2]);
  });

  it("ignores a target the conversation does not hold", () => {
    const kept = filterForLanding(conversation, aliceOnly, 99);

    expect(listThreadIds(kept)).toEqual([1]);
  });
});

describe("holdsThread", () => {
  function makeThreadRow(rootCommentId: number): DigestThreadRow {
    return {
      kind: DigestRowKinds.THREAD,
      thread: thread(rootCommentId),
      digestLine: undefined,
      placement: {
        kind: ThreadPlacementKinds.CHUNK,
        chunkId: "c1",
        rowId: "r1",
      },
      isOwn: false,
    };
  }

  it("finds a thread on its own row or inside a bot group", () => {
    const botGroup = {
      kind: DigestRowKinds.BOT_GROUP,
      author: "coderabbitai",
      threads: [makeThreadRow(8)],
      openCount: 1,
    };
    const ownRow = makeThreadRow(7);

    expect(holdsThread(ownRow, 7)).toBe(true);
    expect(holdsThread(botGroup, 8)).toBe(true);
  });

  it("misses a thread neither row holds", () => {
    const botGroup = {
      kind: DigestRowKinds.BOT_GROUP,
      author: "coderabbitai",
      threads: [makeThreadRow(8)],
      openCount: 1,
    };
    const ownRow = makeThreadRow(7);

    expect(holdsThread(ownRow, 9)).toBe(false);
    expect(holdsThread(botGroup, 9)).toBe(false);
  });
});

describe("buildThreadComposer", () => {
  const HEAD = "a".repeat(40);

  function makeComposerInput(
    plan: Partial<ConversationPlan> = {},
  ): ThreadComposerInput {
    return {
      plan: { postReply: vi.fn(), ...plan } as unknown as ConversationPlan,
      readOnlyReason: undefined,
      mentionSource: { participants: [] },
      focusThreadId: 7,
      refresh: vi.fn(),
      relandInPlace: vi.fn(),
    };
  }

  it("refetches after a post and carries no read-only reason when writable", () => {
    const input = makeComposerInput();
    const composer = buildThreadComposer(input);

    composer.onPosted();

    expect(input.refresh).toHaveBeenCalledTimes(1);
    expect("readOnlyReason" in composer).toBe(false);
    expect(composer.revisionJump).toBeUndefined();
    expect(composer.resolution).toBeUndefined();
  });

  it("states why replying is off", () => {
    const input = { ...makeComposerInput(), readOnlyReason: "No session" };

    expect(buildThreadComposer(input).readOnlyReason).toBe("No session");
  });

  it("relands in place on a jump to the thread already on screen", () => {
    const onJump = vi.fn();
    const input = makeComposerInput({
      revisionJump: {
        knownHeads: new Set([HEAD]),
        currentHeadSha: HEAD,
        onJump,
      },
    });

    buildThreadComposer(input).revisionJump?.onJump(HEAD, 7);

    expect(input.relandInPlace).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith(HEAD, 7);
  });

  it("leaves the landing alone on a jump to another revision", () => {
    const onJump = vi.fn();
    const input = makeComposerInput({
      revisionJump: {
        knownHeads: new Set([HEAD]),
        currentHeadSha: HEAD,
        onJump,
      },
    });
    const otherHead = "b".repeat(40);

    buildThreadComposer(input).revisionJump?.onJump(otherHead, 7);

    expect(input.relandInPlace).not.toHaveBeenCalled();
    expect(onJump).toHaveBeenCalledWith(otherHead, 7);
  });

  it("refetches the conversation after a resolution flip", () => {
    const input = makeComposerInput({
      resolution: {
        canResolve: true,
        setResolved: vi.fn(),
        refetchCapability: vi.fn(),
      },
    });

    buildThreadComposer(input).resolution?.refetchConversation();

    expect(input.refresh).toHaveBeenCalledTimes(1);
  });
});
