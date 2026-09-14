// Boundary guard for the conversation GET's wire body, parsed against a
// REALISTIC wire body; route tests that seed the query cache bypass the
// parser, so this is the contract test.
import { describe, expect, it } from "vitest";
import {
  ReviewCommentSides,
  ReviewVerdictStates as GithubReviewVerdictStates,
  ThreadSubjectTypes as GithubThreadSubjectTypes,
  type ConversationAuthor as GithubConversationAuthor,
  type ConversationComment as GithubConversationComment,
  type ConversationReview as GithubConversationReview,
  type ConversationThread as GithubConversationThread,
  type PrComment as GithubPrComment,
  type PrConversation as GithubPrConversation,
} from "github";
import type { Equals } from "types/utils";
import {
  parseConversation,
  ReviewVerdictStates,
  ThreadSides,
  ThreadSubjectTypes,
  type ConversationAuthor,
  type ConversationComment,
  type ConversationReview,
  type ConversationThread,
  type PrConversation,
  type PrLevelComment,
} from "./types";

function wireConversation(): unknown {
  return {
    threads: [
      {
        rootCommentId: 3_538_588_388,
        path: "src/a.ts",
        line: 12,
        side: "RIGHT",
        subjectType: "LINE",
        isResolved: false,
        isOutdated: false,
        anchorSha: "a".repeat(40),
        comments: [
          {
            commentId: 3_538_588_388,
            author: { login: "alice", isBot: false },
            body: "human note",
            createdAt: "2026-07-01T10:00:00Z",
            url: "https://github.com/o/r/pull/7#discussion_r1",
            reviewId: 4_647_663_464,
          },
          {
            commentId: 3_538_601_871,
            author: { login: "coderabbitai", isBot: true },
            body: "bot reply",
            createdAt: "2026-07-01T11:00:00Z",
            url: "https://github.com/o/r/pull/7#discussion_r2",
          },
        ],
        hasMoreComments: false,
      },
      {
        // Outdated: no line/side; multi-line fields absent.
        rootCommentId: 3_538_700_000,
        path: "src/b.ts",
        subjectType: "LINE",
        isResolved: true,
        isOutdated: true,
        anchorSha: "b".repeat(40),
        comments: [
          {
            commentId: 3_538_700_000,
            author: { login: "bob", isBot: false },
            body: "old note",
            createdAt: "2026-06-30T10:00:00Z",
            url: "https://github.com/o/r/pull/7#discussion_r3",
          },
        ],
        hasMoreComments: true,
      },
    ],
    reviews: [
      {
        reviewId: 4_647_663_464,
        author: { login: "alice", isBot: false },
        state: "CHANGES_REQUESTED",
        body: "needs work",
        submittedAt: "2026-07-01T10:00:00Z",
        url: "https://github.com/o/r/pull/7#pullrequestreview-1",
      },
    ],
    prComments: [
      {
        commentId: 9001,
        author: { login: "carol", isBot: false },
        body: "PR-level remark",
        createdAt: "2026-07-02T09:00:00Z",
        url: "https://github.com/o/r/pull/7#issuecomment-9001",
      },
    ],
    hasMoreThreads: false,
    hasMoreReviews: false,
    hasMorePrComments: true,
  };
}

describe("parseConversation", () => {
  it("accepts a realistic wire body and preserves optional fields", () => {
    const parsed = parseConversation(wireConversation());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const conversation = parsed.value;
    expect(conversation.threads).toHaveLength(2);
    expect(conversation.threads[0]?.line).toBe(12);
    expect(conversation.threads[0]?.side).toBe("RIGHT");
    expect(conversation.threads[0]?.comments[0]?.reviewId).toBe(4_647_663_464);
    expect(conversation.threads[0]?.comments[1]?.reviewId).toBeUndefined();
    expect(conversation.threads[1]?.line).toBeUndefined();
    expect(conversation.threads[1]?.isOutdated).toBe(true);
    expect(conversation.threads[1]?.hasMoreComments).toBe(true);
    expect(conversation.reviews[0]?.state).toBe("CHANGES_REQUESTED");
    expect(conversation.prComments[0]?.author.isBot).toBe(false);
    expect(conversation.hasMorePrComments).toBe(true);
  });

  it("passes an author's https avatarUrl through and drops a non-https one", () => {
    const body = wireConversation();
    if (typeof body !== "object" || body === null) throw new Error("fixture");
    const threads = (body as { threads: Array<Record<string, unknown>> })
      .threads;
    const comments = threads[0]?.["comments"] as Array<Record<string, unknown>>;
    comments[0] = {
      ...comments[0],
      author: {
        login: "alice",
        isBot: false,
        avatarUrl: "https://avatars.example/alice.png",
      },
    };
    comments[1] = {
      ...comments[1],
      author: {
        login: "mallory",
        isBot: false,
        avatarUrl: "javascript:alert(1)",
      },
    };
    const parsed = parseConversation(body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const [root, reply] = parsed.value.threads[0]?.comments ?? [];
    expect(root?.author.avatarUrl).toBe("https://avatars.example/alice.png");
    // Entry survives, the field doesn't; img-src defense.
    expect(reply?.author.login).toBe("mallory");
    expect(reply?.author.avatarUrl).toBeUndefined();
  });

  it("rejects a body missing a thread's root id", () => {
    const body = wireConversation();
    if (typeof body !== "object" || body === null) throw new Error("fixture");
    const threads = (body as { threads: Array<Record<string, unknown>> })
      .threads;
    delete threads[0]?.["rootCommentId"];
    const parsed = parseConversation(body);
    expect(parsed.ok).toBe(false);
  });

  it("rejects an unknown review state", () => {
    const body = wireConversation();
    const reviews = (body as { reviews: Array<Record<string, unknown>> })
      .reviews;
    if (reviews[0]) reviews[0]["state"] = "PENDING";
    const parsed = parseConversation(body);
    expect(parsed.ok).toBe(false);
  });

  it("rejects a fresh LINE thread without a line", () => {
    const body = wireConversation();
    const threads = (body as { threads: Array<Record<string, unknown>> })
      .threads;
    if (threads[0]) delete threads[0]["line"];
    expect(parseConversation(body).ok).toBe(false);
  });

  it("rejects a FILE thread carrying a line", () => {
    const body = wireConversation();
    const threads = (body as { threads: Array<Record<string, unknown>> })
      .threads;
    if (threads[0]) threads[0]["subjectType"] = "FILE";
    expect(parseConversation(body).ok).toBe(false);
  });

  it("rejects a thread whose root id differs from its first comment", () => {
    const body = wireConversation();
    const threads = (body as { threads: Array<Record<string, unknown>> })
      .threads;
    if (threads[0]) threads[0]["rootCommentId"] = 999_999;
    expect(parseConversation(body).ok).toBe(false);
  });

  it("rejects a non-object body", () => {
    expect(parseConversation("nope").ok).toBe(false);
    expect(parseConversation(null).ok).toBe(false);
  });
});

interface VocabularyPin {
  readonly label: string;
  readonly mirror: Readonly<Record<string, string>>;
  readonly source: Readonly<Record<string, string>>;
}

const VOCABULARY_PINS: readonly VocabularyPin[] = [
  {
    label: "ThreadSides",
    mirror: ThreadSides,
    source: ReviewCommentSides,
  },
  {
    label: "ThreadSubjectTypes",
    mirror: ThreadSubjectTypes,
    source: GithubThreadSubjectTypes,
  },
  {
    label: "ReviewVerdictStates",
    mirror: ReviewVerdictStates,
    source: GithubReviewVerdictStates,
  },
];

/**
 * EXACT per-interface shape pins. `Equals` compares key sets AND property
 * types AND modifiers, catching what mutual assignability cannot: an OPTIONAL
 * field renamed or retyped. One pin per nested interface, so a failure names
 * the shape that drifted instead of the whole envelope.
 */
const SHAPE_PINS = {
  ConversationAuthor: true satisfies Equals<
    ConversationAuthor,
    GithubConversationAuthor
  >,
  ConversationComment: true satisfies Equals<
    ConversationComment,
    GithubConversationComment
  >,
  ConversationThread: true satisfies Equals<
    ConversationThread,
    GithubConversationThread
  >,
  ConversationReview: true satisfies Equals<
    ConversationReview,
    GithubConversationReview
  >,
  PrLevelComment: true satisfies Equals<PrLevelComment, GithubPrComment>,
  PrConversation: true satisfies Equals<PrConversation, GithubPrConversation>,
} as const;

describe("conversation vocabulary matches its github source", () => {
  // This module mirrors the github package's `PrConversation` domain shape,
  // and nothing structurally couples the two; CI's per-package path filter
  // does not run this suite when `packages/github` changes. These pins import
  // the source at dev time (never in the client bundle) so either side moving
  // turns the other red.
  it.each(VOCABULARY_PINS)(
    "$label equals its github source map",
    ({ mirror, source }) => {
      // `toEqual` forgives declaration order but catches a renamed key, a
      // dropped member, and a changed wire literal.
      expect({ ...mirror }).toEqual({ ...source });
    },
  );

  it.each(Object.entries(SHAPE_PINS))(
    "%s matches github keys, types, and modifiers",
    (_shape, pinned) => {
      // The pin itself is compile-time (typecheck includes test files); this
      // asserts each one is present, so a pin cannot be silently deleted.
      expect(pinned).toBe(true);
    },
  );
});
