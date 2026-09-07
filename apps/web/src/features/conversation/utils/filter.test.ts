import { describe, expect, it } from "vitest";
import {
  applyConversationFilter,
  conversationFilterSearch,
  countHiddenInlineThreads,
  DEFAULT_CONVERSATION_FILTER,
  isFilterActive,
  isStatedVerdict,
  latestReviewPerAuthor,
  parseConversationFilter,
  reconcileReviewers,
  reviewerFacets,
  verdictFacets,
  withAllReviewers,
  withLatestOnly,
  withNoFilters,
  withNoReviewers,
  withReviewerSelection,
  withVerdictSelection,
} from "./filter";
import type { BriefChunk } from "../../brief/types";
import type {
  ConversationReview,
  ConversationThread,
  PrConversation,
  PrLevelComment,
  ReviewVerdictState,
} from "../types";
import type { Mutable } from "types";

function review(
  reviewId: number,
  login: string,
  state: ReviewVerdictState,
  options: { isBot?: boolean; submittedAt?: string; body?: string } = {},
): ConversationReview {
  const conversationReview: Mutable<ConversationReview> = {
    reviewId,
    author: { login, isBot: options.isBot ?? false },
    state,
    body: options.body ?? `body ${reviewId}`,
    url: `https://github.com/o/r/pull/1#pullrequestreview-${reviewId}`,
  };

  if (options.submittedAt !== undefined) {
    conversationReview.submittedAt = options.submittedAt;
  }

  return conversationReview;
}

function chunkFixture(): BriefChunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/a.ts",
    concern: "implementation",
    role: "core",
    loc: { added: 1, deleted: 0 },
    addedRanges: [],
    removedRanges: [],
    riskSurface: [],
    diff: [
      { kind: "ctx", content: "a", oldLine: 9, newLine: 9 },
      { kind: "add", content: "b", newLine: 10 },
    ],
  };
}

function thread(
  rootCommentId: number,
  login: string,
  isBot = false,
  options: { isOutdated?: boolean } = {},
): ConversationThread {
  const isOutdated = options.isOutdated ?? false;
  const conversationThread: Mutable<ConversationThread> = {
    rootCommentId,
    path: "src/a.ts",
    side: "RIGHT",
    subjectType: "LINE",
    isResolved: false,
    isOutdated,
    comments: [
      {
        commentId: rootCommentId,
        author: { login, isBot },
        body: "note",
        createdAt: "2026-08-01T00:00:00Z",
        url: `https://github.com/o/r/pull/1#discussion_r${rootCommentId}`,
      },
    ],
    hasMoreComments: false,
  };

  if (!isOutdated) conversationThread.line = 10;

  return conversationThread;
}

function prComment(commentId: number, login: string): PrLevelComment {
  return {
    commentId,
    author: { login, isBot: false },
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

describe("parseConversationFilter", () => {
  it("defaults to latest-only with both families inactive", () => {
    expect(parseConversationFilter({})).toEqual(DEFAULT_CONVERSATION_FILTER);
    expect(DEFAULT_CONVERSATION_FILTER.latestOnly).toBe(true);
  });

  it("reads verdict and reviewer selections", () => {
    const filter = parseConversationFilter({
      verdicts: "approved,changes-requested",
      reviewers: "alice,dependabot",
    });
    expect([...filter.verdicts]).toEqual(["APPROVED", "CHANGES_REQUESTED"]);
    expect([...filter.reviewers]).toEqual(["alice", "dependabot"]);
  });

  it("drops unknown verdict tokens rather than failing", () => {
    const filter = parseConversationFilter({
      verdicts: "approved,dismissed,nonsense",
    });
    expect([...filter.verdicts]).toEqual(["APPROVED"]);
  });

  it("turns latest-only off only for the explicit all token", () => {
    expect(parseConversationFilter({ reviews: "all" }).latestOnly).toBe(false);
    expect(parseConversationFilter({ reviews: "latest" }).latestOnly).toBe(
      true,
    );
    expect(parseConversationFilter({ reviews: 42 }).latestOnly).toBe(true);
  });

  it("trims whitespace and skips empty tokens", () => {
    const filter = parseConversationFilter({
      verdicts: " approved , ,commented ",
      reviewers: ",alice, ,",
    });
    expect([...filter.verdicts]).toEqual(["APPROVED", "COMMENTED"]);
    expect([...filter.reviewers]).toEqual(["alice"]);
  });

  it("round-trips through the search shape, omitting default keys entirely", () => {
    expect(conversationFilterSearch(DEFAULT_CONVERSATION_FILTER)).toEqual({});
    const filter = parseConversationFilter({
      verdicts: "commented",
      reviewers: "bob",
      reviews: "all",
    });
    const search = conversationFilterSearch(filter);
    expect(search).toEqual({
      verdicts: "commented",
      reviewers: "bob",
      reviews: "all",
    });
    expect(parseConversationFilter(search)).toEqual(filter);
  });
});

describe("latestReviewPerAuthor", () => {
  it("keeps the newest submitted review per author", () => {
    const reviews = [
      review(1, "alice", "APPROVED", { submittedAt: "2026-08-01T00:00:00Z" }),
      review(2, "alice", "CHANGES_REQUESTED", {
        submittedAt: "2026-08-02T00:00:00Z",
      }),
      review(3, "bob", "COMMENTED", { submittedAt: "2026-08-01T00:00:00Z" }),
    ];
    expect(latestReviewPerAuthor(reviews).map((r) => r.reviewId)).toEqual([
      2, 3,
    ]);
  });

  it("prefers the newest timestamp even when it arrives earlier in the array", () => {
    const reviews = [
      review(1, "alice", "APPROVED", { submittedAt: "2026-08-05T00:00:00Z" }),
      review(2, "alice", "COMMENTED", { submittedAt: "2026-08-01T00:00:00Z" }),
    ];
    expect(latestReviewPerAuthor(reviews).map((r) => r.reviewId)).toEqual([1]);
  });

  it("falls back to array order when timestamps are absent", () => {
    const reviews = [
      review(1, "alice", "APPROVED"),
      review(2, "alice", "CHANGES_REQUESTED"),
    ];
    expect(latestReviewPerAuthor(reviews).map((r) => r.reviewId)).toEqual([2]);
  });

  it("preserves first-appearance order of authors", () => {
    const reviews = [
      review(1, "zoe", "COMMENTED"),
      review(2, "alice", "APPROVED"),
      review(3, "zoe", "APPROVED"),
    ];
    expect(latestReviewPerAuthor(reviews).map((r) => r.reviewId)).toEqual([
      3, 2,
    ]);
  });
});

describe("applyConversationFilter", () => {
  const conversation = buildConversation({
    reviews: [
      review(1, "alice", "APPROVED"),
      review(2, "bob", "CHANGES_REQUESTED"),
      review(3, "botty", "COMMENTED", { isBot: true }),
      review(4, "carol", "DISMISSED"),
    ],
    threads: [
      thread(10, "alice"),
      thread(11, "bob"),
      thread(12, "botty", true),
    ],
    prComments: [prComment(20, "alice"), prComment(21, "bob")],
  });

  it("passes everything through when both families are inactive", () => {
    const filtered = applyConversationFilter(
      conversation,
      DEFAULT_CONVERSATION_FILTER,
    );
    expect(filtered.reviews).toHaveLength(4);
    expect(filtered.threads).toHaveLength(3);
    expect(filtered.prComments).toHaveLength(2);
  });

  it("ORs within the verdict family and leaves threads untouched", () => {
    const filter = parseConversationFilter({
      verdicts: "approved,changes-requested",
    });
    const filtered = applyConversationFilter(conversation, filter);
    expect(filtered.reviews.map((r) => r.reviewId)).toEqual([1, 2]);
    expect(filtered.threads).toHaveLength(3);
    expect(filtered.prComments).toHaveLength(2);
  });

  it("hides dismissed reviews under any active verdict filter", () => {
    const filter = parseConversationFilter({ verdicts: "commented" });
    const filtered = applyConversationFilter(conversation, filter);
    expect(filtered.reviews.map((r) => r.reviewId)).toEqual([3]);
  });

  it("applies reviewer selection to reviews, threads and PR comments", () => {
    const filter = parseConversationFilter({ reviewers: "alice" });
    const filtered = applyConversationFilter(conversation, filter);
    expect(filtered.reviews.map((r) => r.reviewId)).toEqual([1]);
    expect(filtered.threads.map((t) => t.rootCommentId)).toEqual([10]);
    expect(filtered.prComments.map((c) => c.commentId)).toEqual([20]);
  });

  it("applies all three axes together, reducing before filtering", () => {
    const repeated = buildConversation({
      reviews: [
        review(1, "alice", "APPROVED", { submittedAt: "2026-08-01T00:00:00Z" }),
        review(2, "alice", "CHANGES_REQUESTED", {
          submittedAt: "2026-08-02T00:00:00Z",
        }),
        review(3, "bob", "APPROVED", { submittedAt: "2026-08-01T00:00:00Z" }),
      ],
    });
    // Latest-only + reviewers=alice + verdicts=approved: alice's approval is
    // no longer her latest, so nothing matches, the reduction runs FIRST.
    const filter = parseConversationFilter({
      verdicts: "approved",
      reviewers: "alice",
    });
    expect(applyConversationFilter(repeated, filter).reviews).toEqual([]);
    const allReviews = parseConversationFilter({
      verdicts: "approved",
      reviewers: "alice",
      reviews: "all",
    });
    expect(
      applyConversationFilter(repeated, allReviews).reviews.map(
        (r) => r.reviewId,
      ),
    ).toEqual([1]);
  });

  it("ANDs across families", () => {
    const filter = parseConversationFilter({
      verdicts: "approved",
      reviewers: "alice,bob",
    });
    const filtered = applyConversationFilter(conversation, filter);
    expect(filtered.reviews.map((r) => r.reviewId)).toEqual([1]);
    expect(filtered.threads.map((t) => t.rootCommentId)).toEqual([10, 11]);
  });

  it("reduces to the latest review per author before filtering", () => {
    const repeated = buildConversation({
      reviews: [
        review(1, "alice", "APPROVED"),
        review(2, "alice", "CHANGES_REQUESTED"),
      ],
    });
    const latest = applyConversationFilter(
      repeated,
      DEFAULT_CONVERSATION_FILTER,
    );
    expect(latest.reviews.map((r) => r.reviewId)).toEqual([2]);

    const all = applyConversationFilter(
      repeated,
      parseConversationFilter({ reviews: "all" }),
    );
    expect(all.reviews.map((r) => r.reviewId)).toEqual([1, 2]);
  });

  it("keeps the overflow flags", () => {
    const filtered = applyConversationFilter(
      { ...conversation, hasMoreThreads: true },
      parseConversationFilter({ reviewers: "alice" }),
    );
    expect(filtered.hasMoreThreads).toBe(true);
  });
});

describe("verdictFacets", () => {
  const conversation = buildConversation({
    reviews: [
      review(1, "alice", "APPROVED"),
      review(2, "bob", "APPROVED"),
      review(3, "botty", "APPROVED", { isBot: true }),
      review(4, "carol", "CHANGES_REQUESTED"),
      review(5, "dan", "DISMISSED"),
    ],
  });

  it("counts humans and bots separately, in canonical order", () => {
    expect(verdictFacets(conversation, DEFAULT_CONVERSATION_FILTER)).toEqual([
      { state: "APPROVED", humanCount: 2, botCount: 1 },
      { state: "CHANGES_REQUESTED", humanCount: 1, botCount: 0 },
    ]);
  });

  it("omits states with no reviews and never counts dismissed", () => {
    const facets = verdictFacets(conversation, DEFAULT_CONVERSATION_FILTER);
    expect(facets.map((facet) => facet.state)).not.toContain("COMMENTED");
    expect(facets.map((facet) => facet.state)).not.toContain("DISMISSED");
  });

  it("ignores its own family's selection so unselected chips keep counts", () => {
    const filter = parseConversationFilter({ verdicts: "approved" });
    expect(verdictFacets(conversation, filter)).toEqual([
      { state: "APPROVED", humanCount: 2, botCount: 1 },
      { state: "CHANGES_REQUESTED", humanCount: 1, botCount: 0 },
    ]);
  });

  it("emits a bot-only state as a chip with a zero human count", () => {
    const botOnly = buildConversation({
      reviews: [review(1, "botty", "COMMENTED", { isBot: true })],
    });
    expect(verdictFacets(botOnly, DEFAULT_CONVERSATION_FILTER)).toEqual([
      { state: "COMMENTED", humanCount: 0, botCount: 1 },
    ]);
  });

  it("facets under the reviewer selection", () => {
    const filter = parseConversationFilter({ reviewers: "alice,carol" });
    expect(verdictFacets(conversation, filter)).toEqual([
      { state: "APPROVED", humanCount: 1, botCount: 0 },
      { state: "CHANGES_REQUESTED", humanCount: 1, botCount: 0 },
    ]);
  });

  it("counts under the recency reduction", () => {
    const repeated = buildConversation({
      reviews: [
        review(1, "alice", "APPROVED"),
        review(2, "alice", "CHANGES_REQUESTED"),
      ],
    });
    expect(verdictFacets(repeated, DEFAULT_CONVERSATION_FILTER)).toEqual([
      { state: "CHANGES_REQUESTED", humanCount: 1, botCount: 0 },
    ]);
    expect(
      verdictFacets(repeated, parseConversationFilter({ reviews: "all" })),
    ).toEqual([
      { state: "APPROVED", humanCount: 1, botCount: 0 },
      { state: "CHANGES_REQUESTED", humanCount: 1, botCount: 0 },
    ]);
  });
});

describe("reviewerFacets", () => {
  it("lists every activity author once, humans before bots, alphabetically", () => {
    const conversation = buildConversation({
      reviews: [
        review(1, "zoe", "APPROVED"),
        review(2, "botty", "COMMENTED", { isBot: true }),
      ],
      threads: [thread(10, "alice"), thread(11, "zoe")],
      prComments: [prComment(20, "mallory")],
    });
    expect(reviewerFacets(conversation)).toEqual([
      { login: "alice", isBot: false },
      { login: "mallory", isBot: false },
      { login: "zoe", isBot: false },
      { login: "botty", isBot: true },
    ]);
  });

  it("keeps an author whose only review is an inline-comment envelope", () => {
    // The chip list is activity-wide, not verdict-derived: alice still has
    // threads to filter to even with nothing stated.
    const conversation = buildConversation({
      reviews: [review(1, "alice", "COMMENTED", { body: "" })],
      threads: [thread(10, "alice")],
    });
    expect(reviewerFacets(conversation).map((facet) => facet.login)).toEqual([
      "alice",
    ]);
  });
});

describe("countHiddenInlineThreads", () => {
  const chunks = [chunkFixture()];

  it("counts the inline threads the reviewer selection removes", () => {
    const conversation = buildConversation({
      threads: [thread(10, "alice"), thread(11, "bob"), thread(12, "carol")],
    });
    expect(
      countHiddenInlineThreads(
        conversation,
        parseConversationFilter({ reviewers: "alice" }),
        chunks,
      ),
    ).toBe(2);
    expect(
      countHiddenInlineThreads(
        conversation,
        DEFAULT_CONVERSATION_FILTER,
        chunks,
      ),
    ).toBe(0);
  });

  it("ignores threads that never render in the diff", () => {
    // Outdated threads are digest-only, so hiding them costs the diff
    // nothing, warning about them would train the reader to ignore the pill.
    const conversation = buildConversation({
      threads: [
        thread(10, "alice"),
        thread(11, "bob", false, { isOutdated: true }),
        thread(12, "bob", false, { isOutdated: true }),
      ],
    });
    expect(
      countHiddenInlineThreads(
        conversation,
        parseConversationFilter({ reviewers: "alice" }),
        chunks,
      ),
    ).toBe(0);
  });

  it("counts a bot's inline threads too", () => {
    const conversation = buildConversation({
      threads: [thread(10, "alice"), thread(11, "botty", true)],
    });
    expect(
      countHiddenInlineThreads(
        conversation,
        parseConversationFilter({ reviewers: "alice" }),
        chunks,
      ),
    ).toBe(1);
  });

  it("is unaffected by the verdict family, which never filters threads", () => {
    const conversation = buildConversation({ threads: [thread(10, "alice")] });
    expect(
      countHiddenInlineThreads(
        conversation,
        parseConversationFilter({ verdicts: "approved" }),
        chunks,
      ),
    ).toBe(0);
  });
});

describe("isStatedVerdict", () => {
  it("rejects the empty COMMENTED envelope GitHub mints for inline comments", () => {
    expect(isStatedVerdict(review(1, "alice", "COMMENTED", { body: "" }))).toBe(
      false,
    );
    expect(
      isStatedVerdict(review(2, "alice", "COMMENTED", { body: "   " })),
    ).toBe(false);
    expect(isStatedVerdict(review(3, "alice", "COMMENTED"))).toBe(true);
    expect(isStatedVerdict(review(4, "alice", "APPROVED", { body: "" }))).toBe(
      true,
    );
  });

  it("keeps a standing approval when the author later comments inline", () => {
    const conversation = buildConversation({
      reviews: [
        review(1, "alice", "APPROVED", { submittedAt: "2026-08-01T00:00:00Z" }),
        review(2, "alice", "COMMENTED", {
          body: "",
          submittedAt: "2026-08-02T00:00:00Z",
        }),
      ],
    });
    const filtered = applyConversationFilter(
      conversation,
      DEFAULT_CONVERSATION_FILTER,
    );
    expect(filtered.reviews.map((r) => r.reviewId)).toEqual([1]);
    expect(verdictFacets(conversation, DEFAULT_CONVERSATION_FILTER)).toEqual([
      { state: "APPROVED", humanCount: 1, botCount: 0 },
    ]);
  });
});

describe("reconcileReviewers", () => {
  const conversation = buildConversation({
    reviews: [review(1, "alice", "APPROVED")],
    threads: [thread(10, "bob")],
  });

  it("drops logins nobody on this PR matches", () => {
    const filter = parseConversationFilter({ reviewers: "alice,ghost" });
    expect([...reconcileReviewers(filter, conversation).reviewers]).toEqual([
      "alice",
    ]);
  });

  it("clears unmatched reviewer filters so they cannot hide everything", () => {
    const filter = parseConversationFilter({ reviewers: "ghost" });
    const reconciled = reconcileReviewers(filter, conversation);
    expect(reconciled.reviewers.size).toBe(0);
    expect(
      applyConversationFilter(conversation, reconciled).reviews,
    ).toHaveLength(1);
  });

  it("returns the same object when every login is known", () => {
    const filter = parseConversationFilter({ reviewers: "alice,bob" });
    expect(reconcileReviewers(filter, conversation)).toBe(filter);
    expect(reconcileReviewers(DEFAULT_CONVERSATION_FILTER, conversation)).toBe(
      DEFAULT_CONVERSATION_FILTER,
    );
  });
});

describe("selection helpers", () => {
  it("toggles a verdict without touching the other family", () => {
    const selected = withVerdictSelection(
      DEFAULT_CONVERSATION_FILTER,
      "APPROVED",
    );
    expect([...selected.verdicts]).toEqual(["APPROVED"]);
    expect(selected.latestOnly).toBe(true);
    expect([...withVerdictSelection(selected, "APPROVED").verdicts]).toEqual(
      [],
    );
  });

  it("toggles a reviewer", () => {
    const one = withReviewerSelection(DEFAULT_CONVERSATION_FILTER, "alice");
    const two = withReviewerSelection(one, "bob");
    expect([...two.reviewers]).toEqual(["alice", "bob"]);
    expect([...withReviewerSelection(two, "alice").reviewers]).toEqual(["bob"]);
  });

  it("All selects everyone; None clears back to inactive", () => {
    const all = withAllReviewers(DEFAULT_CONVERSATION_FILTER, [
      "alice",
      "botty",
    ]);
    expect([...all.reviewers]).toEqual(["alice", "botty"]);
    const none = withNoReviewers(all);
    expect(none.reviewers.size).toBe(0);
    expect(isFilterActive(none)).toBe(false);
    expect(isFilterActive(all)).toBe(true);
  });

  it("clears both families but preserves an opted-into full history", () => {
    const filter = withReviewerSelection(
      withVerdictSelection(
        parseConversationFilter({ reviews: "all" }),
        "APPROVED",
      ),
      "alice",
    );
    const cleared = withNoFilters(filter);
    expect(isFilterActive(cleared)).toBe(false);
    expect(cleared.latestOnly).toBe(false);
  });

  it("flips the recency toggle without disturbing selections", () => {
    const filter = withLatestOnly(
      withVerdictSelection(DEFAULT_CONVERSATION_FILTER, "COMMENTED"),
      false,
    );
    expect(filter.latestOnly).toBe(false);
    expect([...filter.verdicts]).toEqual(["COMMENTED"]);
  });
});
