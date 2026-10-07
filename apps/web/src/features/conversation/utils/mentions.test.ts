import { describe, expect, it } from "vitest";

import type { ConversationThread } from "../types";
import {
  mentionCandidatesFromThread,
  mergeMentionCandidates,
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
      author: { login: author.login, isBot: author.isBot ?? false },
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
    ).toEqual([{ login: "alice" }, { login: "bob" }]);
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
      { login: "alice", avatarUrl: "https://avatars.example/alice.png" },
    ]);
  });
});

describe("mergeMentionCandidates", () => {
  it("lists enriched participants first, then remaining collaborators", () => {
    const merged = mergeMentionCandidates(
      [{ login: "zed" }, { login: "alice" }],
      [
        { login: "alice", name: "Alice Example", avatarUrl: "https://a/alice" },
        { login: "bob", name: "Bob Builder", avatarUrl: "https://a/bob" },
        { login: "zed", avatarUrl: "https://a/zed" },
      ],
    );
    expect(merged).toEqual([
      // Participant order preserved: order is the autocomplete ranking.
      { login: "zed", avatarUrl: "https://a/zed" },
      { login: "alice", name: "Alice Example", avatarUrl: "https://a/alice" },
      // Non-participant collaborators follow, deduped by login.
      { login: "bob", name: "Bob Builder", avatarUrl: "https://a/bob" },
    ]);
  });

  it("keeps a participant absent from the roster as a login-only entry", () => {
    expect(
      mergeMentionCandidates(
        [{ login: "fork-author" }],
        [{ login: "bob", name: "Bob Builder" }],
      ),
    ).toEqual([
      { login: "fork-author" },
      { login: "bob", name: "Bob Builder" },
    ]);
  });

  it("falls back to participants only when the roster is empty", () => {
    expect(mergeMentionCandidates([{ login: "alice" }], [])).toEqual([
      { login: "alice" },
    ]);
  });
});
