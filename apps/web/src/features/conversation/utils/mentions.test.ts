import { describe, expect, it } from "vitest";

import { MentionCandidateKinds } from "@web/components/MarkdownTextarea/types";
import type { ConversationThread } from "../types";
import {
  mentionCandidatesFromThread,
  mergeMentionCandidates,
  shapeUserCandidate,
} from "./mentions";

function thread(
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
      author: {
        kind: MentionCandidateKinds.USER,
        login: author.login,
        isBot: author.isBot ?? false,
      },
      body: "b",
      createdAt: "2026-07-29T00:00:00Z",
      url: `https://example.com/${index}`,
    })),
    hasMoreComments: false,
  };
}

describe("mentionCandidatesFromThread", () => {
  it("dedupes participants in first-seen order and drops bots", () => {
    expect(
      mentionCandidatesFromThread(
        thread([
          { login: "alice" },
          { login: "brief-bot", isBot: true },
          { login: "bob" },
          { login: "alice" },
        ]),
      ),
    ).toEqual([
      { kind: MentionCandidateKinds.USER, login: "alice" },
      { kind: MentionCandidateKinds.USER, login: "bob" },
    ]);
  });

  it("carries the author's payload avatar into the candidate", () => {
    const withAvatar = thread([{ login: "alice" }]);
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
    expect(mentionCandidatesFromThread(enriched)).toEqual([
      {
        kind: MentionCandidateKinds.USER,
        login: "alice",
        avatarUrl: "https://avatars.example/alice.png",
      },
    ]);
  });
});

describe("mergeMentionCandidates", () => {
  it("lists enriched participants first, then remaining collaborators", () => {
    const merged = mergeMentionCandidates(
      [
        { kind: MentionCandidateKinds.USER, login: "zed" },
        { kind: MentionCandidateKinds.USER, login: "alice" },
      ],
      [
        {
          kind: MentionCandidateKinds.USER,
          login: "alice",
          name: "Alice Example",
          avatarUrl: "https://a/alice",
        },
        {
          kind: MentionCandidateKinds.USER,
          login: "bob",
          name: "Bob Builder",
          avatarUrl: "https://a/bob",
        },
        {
          kind: MentionCandidateKinds.USER,
          login: "zed",
          avatarUrl: "https://a/zed",
        },
      ],
    );
    expect(merged).toEqual([
      // Participant order preserved: order is the autocomplete ranking.
      {
        kind: MentionCandidateKinds.USER,
        login: "zed",
        avatarUrl: "https://a/zed",
      },
      {
        kind: MentionCandidateKinds.USER,
        login: "alice",
        name: "Alice Example",
        avatarUrl: "https://a/alice",
      },
      // Non-participant collaborators follow, deduped by login.
      {
        kind: MentionCandidateKinds.USER,
        login: "bob",
        name: "Bob Builder",
        avatarUrl: "https://a/bob",
      },
    ]);
  });

  it("keeps a participant absent from the roster as a login-only entry", () => {
    expect(
      mergeMentionCandidates(
        [{ kind: MentionCandidateKinds.USER, login: "fork-author" }],
        [
          {
            kind: MentionCandidateKinds.USER,
            login: "bob",
            name: "Bob Builder",
          },
        ],
      ),
    ).toEqual([
      { kind: MentionCandidateKinds.USER, login: "fork-author" },
      { kind: MentionCandidateKinds.USER, login: "bob", name: "Bob Builder" },
    ]);
  });

  it("falls back to participants only when the roster is empty", () => {
    expect(
      mergeMentionCandidates(
        [{ kind: MentionCandidateKinds.USER, login: "alice" }],
        [],
      ),
    ).toEqual([{ kind: MentionCandidateKinds.USER, login: "alice" }]);
  });
});

describe("shapeUserCandidate", () => {
  it("marks a roster row a user and drops absent fields", () => {
    expect(shapeUserCandidate({ login: "alice", name: "Alice" })).toEqual({
      kind: MentionCandidateKinds.USER,
      login: "alice",
      name: "Alice",
    });
  });
});
