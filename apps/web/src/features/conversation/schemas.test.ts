// Boundary guard for the conversation GET's wire body, parsed against a
// REALISTIC wire body; route tests that seed the query cache bypass the
// parser, so this is the contract test.
import { describe, expect, it } from "vitest";
import type { Equals } from "types/utils";
import type { z } from "zod/v4";

import type { MentionCandidate } from "@web/components/MarkdownTextarea/useMentionAutocomplete";

import {
  parseCollaborators,
  parseConversation,
  type conversationAuthorSchema,
  type conversationCommentSchema,
  type conversationReviewSchema,
  type conversationThreadSchema,
  type mentionCandidateSchema,
  type prConversationSchema,
  type prLevelCommentSchema,
} from "./schemas";
import type {
  ConversationAuthor,
  ConversationComment,
  ConversationReview,
  ConversationThread,
  PrConversation,
  PrLevelComment,
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
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
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
    if (typeof body !== "object" || body === null) {
      throw new Error("fixture");
    }
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
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    const [root, reply] = parsed.value.threads[0]?.comments ?? [];
    expect(root?.author.avatarUrl).toBe("https://avatars.example/alice.png");
    // Entry survives, the field doesn't; img-src defense.
    expect(reply?.author.login).toBe("mallory");
    expect(reply?.author.avatarUrl).toBeUndefined();
  });

  it("rejects a body missing a thread's root id", () => {
    const body = wireConversation();
    if (typeof body !== "object" || body === null) {
      throw new Error("fixture");
    }
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
    if (reviews[0]) {
      reviews[0]["state"] = "PENDING";
    }
    const parsed = parseConversation(body);
    expect(parsed.ok).toBe(false);
  });

  it("rejects a fresh LINE thread without a line", () => {
    const body = wireConversation();
    const threads = (body as { threads: Array<Record<string, unknown>> })
      .threads;
    if (threads[0]) {
      delete threads[0]["line"];
    }
    expect(parseConversation(body).ok).toBe(false);
  });

  it("rejects a FILE thread carrying a line", () => {
    const body = wireConversation();
    const threads = (body as { threads: Array<Record<string, unknown>> })
      .threads;
    if (threads[0]) {
      threads[0]["subjectType"] = "FILE";
    }
    expect(parseConversation(body).ok).toBe(false);
  });

  it("rejects a thread whose root id differs from its first comment", () => {
    const body = wireConversation();
    const threads = (body as { threads: Array<Record<string, unknown>> })
      .threads;
    if (threads[0]) {
      threads[0]["rootCommentId"] = 999_999;
    }
    expect(parseConversation(body).ok).toBe(false);
  });

  it("rejects a non-object body", () => {
    expect(parseConversation("nope").ok).toBe(false);
    expect(parseConversation(null).ok).toBe(false);
  });

  it("drops an author's non-string avatarUrl and keeps the author", () => {
    const body = wireConversation();
    const reviews = (body as { reviews: Array<Record<string, unknown>> })
      .reviews;
    if (reviews[0]) {
      reviews[0]["author"] = { login: "alice", isBot: false, avatarUrl: 7 };
    }
    const parsed = parseConversation(body);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.reviews[0]?.author).toEqual({
      login: "alice",
      isBot: false,
    });
  });
});

describe("parseCollaborators", () => {
  it("reads mention candidates and keeps only https avatars", () => {
    const parsed = parseCollaborators({
      collaborators: [
        {
          login: "alice",
          name: "Alice",
          avatarUrl: "https://avatars.example/alice.png",
        },
        { login: "mallory", avatarUrl: "http://avatars.example/m.png" },
        { login: "bob" },
      ],
      hasMore: true,
    });

    expect(parsed).toEqual({
      ok: true,
      value: [
        {
          login: "alice",
          name: "Alice",
          avatarUrl: "https://avatars.example/alice.png",
        },
        { login: "mallory" },
        { login: "bob" },
      ],
    });
  });

  it("rejects a body without hasMore or with a malformed entry", () => {
    expect(parseCollaborators({ collaborators: [] }).ok).toBe(false);
    expect(
      parseCollaborators({ collaborators: [{ name: "x" }], hasMore: false }).ok,
    ).toBe(false);
    expect(
      parseCollaborators({
        collaborators: [{ login: "alice", name: 7 }],
        hasMore: false,
      }).ok,
    ).toBe(false);
  });

  it("drops an entry's non-string avatarUrl and keeps the entry", () => {
    const parsed = parseCollaborators({
      collaborators: [{ login: "alice", avatarUrl: 7 }],
      hasMore: false,
    });

    expect(parsed).toEqual({ ok: true, value: [{ login: "alice" }] });
  });
});

const SCHEMA_PINS = {
  ConversationAuthor: true satisfies Equals<
    z.output<typeof conversationAuthorSchema>,
    ConversationAuthor
  >,
  ConversationComment: true satisfies Equals<
    z.output<typeof conversationCommentSchema>,
    ConversationComment
  >,
  ConversationThread: true satisfies Equals<
    z.output<typeof conversationThreadSchema>,
    ConversationThread
  >,
  ConversationReview: true satisfies Equals<
    z.output<typeof conversationReviewSchema>,
    ConversationReview
  >,
  PrLevelComment: true satisfies Equals<
    z.output<typeof prLevelCommentSchema>,
    PrLevelComment
  >,
  PrConversation: true satisfies Equals<
    z.output<typeof prConversationSchema>,
    PrConversation
  >,
  MentionCandidate: true satisfies Equals<
    z.output<typeof mentionCandidateSchema>,
    MentionCandidate
  >,
} as const;

describe("conversation schemas match their interfaces", () => {
  it.each(Object.entries(SCHEMA_PINS))("%s is pinned", (_shape, pinned) => {
    expect(pinned).toBe(true);
  });
});
