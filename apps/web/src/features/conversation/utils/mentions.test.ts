import { describe, expect, it } from "vitest";

import {
  MentionCandidateKinds,
  type MentionTeamCandidate,
  type MentionUserCandidate,
} from "@web/components/MarkdownTextarea/types";
import { makeConversation } from "../test-utils";
import {
  MentionSearchResultKinds,
  type ConversationThread,
  type MentionSearchResult,
  type PrConversation,
} from "../types";
import {
  buildMentionSource,
  buildThreadMentionSource,
  isMentionSearchable,
  listConversationParticipants,
  listThreadParticipants,
  mergeMentionCandidates,
  mergeParticipants,
  shapeTeamCandidate,
  shapeUserCandidate,
} from "./mentions";

function makeThread(
  authors: Array<{ login: string; isBot?: boolean }>,
): ConversationThread {
  return {
    rootCommentId: 1,
    path: "src/a.ts",
    subjectType: "LINE",
    isResolved: false,
    isOutdated: false,
    comments: authors.map((author, index) => ({
      commentId: index + 1,
      author: { login: author.login, isBot: author.isBot ?? false },
      body: "b",
      createdAt: "2026-07-29T00:00:00Z",
      url: `https://example.com/${index}`,
    })),
    hasMoreComments: false,
  };
}

function makeUser(login: string, name?: string): MentionUserCandidate {
  if (name === undefined) {
    return { kind: MentionCandidateKinds.USER, login };
  }
  return { kind: MentionCandidateKinds.USER, login, name };
}

function makeTeam(
  combinedSlug: `${string}/${string}`,
  name: string,
): MentionTeamCandidate {
  return { kind: MentionCandidateKinds.TEAM, combinedSlug, name };
}

function makeAnswer(
  query: string,
  users: readonly MentionUserCandidate[],
  teams: readonly MentionTeamCandidate[] = [],
): MentionSearchResult {
  return { kind: MentionSearchResultKinds.READY, query, users, teams };
}

describe("listThreadParticipants", () => {
  it("dedupes participants in first-seen order and drops bots", () => {
    expect(
      listThreadParticipants(
        makeThread([
          { login: "alice" },
          { login: "brief-bot", isBot: true },
          { login: "bob" },
          { login: "alice" },
        ]),
      ),
    ).toEqual([makeUser("alice"), makeUser("bob")]);
  });

  it("carries the author's payload avatar into the candidate", () => {
    const withAvatar = makeThread([{ login: "alice" }]);
    const comment = withAvatar.comments[0];
    if (comment === undefined) {
      throw new Error("fixture");
    }
    const enriched: ConversationThread = {
      ...withAvatar,
      comments: [
        {
          ...comment,
          author: {
            ...comment.author,
            avatarUrl: "https://avatars.example/alice.png",
          },
        },
      ],
    };
    expect(listThreadParticipants(enriched)).toEqual([
      {
        kind: MentionCandidateKinds.USER,
        login: "alice",
        avatarUrl: "https://avatars.example/alice.png",
      },
    ]);
  });
});

describe("listConversationParticipants", () => {
  it("lists thread, review and comment authors once, bots excluded", () => {
    const base = makeConversation(["alice", "bob"]);
    const conversation: PrConversation = {
      ...base,
      reviews: [
        {
          reviewId: 1,
          author: { login: "carol", isBot: false },
          state: "APPROVED",
          body: "",
          url: "https://example.test/r/1",
        },
        {
          reviewId: 2,
          author: { login: "alice", isBot: false },
          state: "COMMENTED",
          body: "",
          url: "https://example.test/r/2",
        },
      ],
      prComments: [
        {
          commentId: 3,
          author: { login: "renovate", isBot: true },
          body: "bump",
          createdAt: "2026-08-01T00:00:00Z",
          url: "https://example.test/c/3",
        },
        {
          commentId: 4,
          author: { login: "dave", isBot: false },
          body: "hi",
          createdAt: "2026-08-01T00:00:00Z",
          url: "https://example.test/c/4",
        },
      ],
    };

    expect(listConversationParticipants(conversation)).toEqual([
      makeUser("alice"),
      makeUser("bob"),
      makeUser("carol"),
      makeUser("dave"),
    ]);
  });
});

describe("buildMentionSource", () => {
  it("pairs the repo with the loaded conversation's participants", () => {
    expect(buildMentionSource("42", makeConversation(["alice"]))).toEqual({
      repoId: "42",
      participants: [makeUser("alice")],
    });
  });

  it("offers no participants before the conversation loads", () => {
    expect(buildMentionSource(undefined, undefined)).toEqual({
      participants: [],
    });
  });
});

describe("buildThreadMentionSource", () => {
  it("ranks the thread's participants before the conversation's", () => {
    const source = buildThreadMentionSource(
      makeThread([{ login: "zed" }, { login: "alice" }]),
      { repoId: "42", participants: [makeUser("alice"), makeUser("bob")] },
    );

    expect(source).toEqual({
      repoId: "42",
      participants: [makeUser("zed"), makeUser("alice"), makeUser("bob")],
    });
  });

  it("offers the thread's participants alone without a conversation source", () => {
    expect(
      buildThreadMentionSource(makeThread([{ login: "zed" }]), undefined),
    ).toEqual({ participants: [makeUser("zed")] });
  });
});

describe("mergeParticipants", () => {
  it("keeps the first list's order and appends only the new logins", () => {
    expect(
      mergeParticipants(
        [makeUser("zed"), makeUser("alice")],
        [makeUser("Alice"), makeUser("bob")],
      ),
    ).toEqual([makeUser("zed"), makeUser("alice"), makeUser("bob")]);
  });
});

describe("mergeMentionCandidates", () => {
  it("lists matching participants first, then GitHub's users and teams", () => {
    const merged = mergeMentionCandidates(
      "a",
      [makeUser("zed"), makeUser("anna")],
      makeAnswer(
        "a",
        [makeUser("alice", "Alice Example")],
        [makeTeam("acme/api", "API")],
      ),
    );

    expect(merged).toEqual([
      makeUser("anna"),
      makeUser("alice", "Alice Example"),
      makeTeam("acme/api", "API"),
    ]);
  });

  it("enriches a participant from GitHub's row and lists it once", () => {
    const merged = mergeMentionCandidates(
      "al",
      [makeUser("alice")],
      makeAnswer("al", [
        {
          kind: MentionCandidateKinds.USER,
          login: "Alice",
          name: "Alice Example",
          avatarUrl: "https://a/alice",
        },
        makeUser("alan"),
      ]),
    );

    expect(merged).toEqual([
      {
        kind: MentionCandidateKinds.USER,
        login: "alice",
        name: "Alice Example",
        avatarUrl: "https://a/alice",
      },
      makeUser("alan"),
    ]);
  });

  it("narrows an older answer to rows that still match the query", () => {
    const merged = mergeMentionCandidates(
      "ali",
      [],
      makeAnswer(
        "al",
        [
          makeUser("alice"),
          makeUser("alan"),
          makeUser("smith", "Alison Smith"),
        ],
        [makeTeam("acme/alias", "Aliases"), makeTeam("acme/web", "Web")],
      ),
    );

    expect(merged).toEqual([
      makeUser("alice"),
      makeUser("smith", "Alison Smith"),
      makeTeam("acme/alias", "Aliases"),
    ]);
  });

  it("matches the query without case", () => {
    expect(
      mergeMentionCandidates(
        "AL",
        [makeUser("Alice")],
        makeAnswer("al", [makeUser("ALAN")]),
      ),
    ).toEqual([makeUser("Alice"), makeUser("ALAN")]);
  });

  it("offers participants alone when GitHub's answer is unavailable", () => {
    expect(
      mergeMentionCandidates("a", [makeUser("alice"), makeUser("bob")], {
        kind: MentionSearchResultKinds.UNAVAILABLE,
        query: "a",
      }),
    ).toEqual([makeUser("alice")]);
  });

  it("offers participants alone without any answer", () => {
    expect(
      mergeMentionCandidates(
        "",
        [makeUser("alice"), makeUser("bob")],
        undefined,
      ),
    ).toEqual([makeUser("alice"), makeUser("bob")]);
  });
});

describe("isMentionSearchable", () => {
  it("searches up to the route's query bound and not past it", () => {
    expect(isMentionSearchable("42", "")).toBe(true);
    expect(isMentionSearchable("42", "a".repeat(140))).toBe(true);
    expect(isMentionSearchable("42", "a".repeat(141))).toBe(false);
  });

  it("never searches without a repo or a query", () => {
    expect(isMentionSearchable(undefined, "al")).toBe(false);
    expect(isMentionSearchable("42", undefined)).toBe(false);
  });
});

describe("shapeUserCandidate", () => {
  it("marks a GitHub user a candidate and drops absent fields", () => {
    expect(shapeUserCandidate({ login: "alice", name: "Alice" })).toEqual(
      makeUser("alice", "Alice"),
    );
  });
});

describe("shapeTeamCandidate", () => {
  it("marks a GitHub team a team candidate", () => {
    expect(
      shapeTeamCandidate({ combinedSlug: "acme/core", name: "Core" }),
    ).toEqual(makeTeam("acme/core", "Core"));
  });
});
