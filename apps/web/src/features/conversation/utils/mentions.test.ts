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
});

describe("mergeMentionCandidates", () => {
  it("keeps participants first (enriched by login match), then remaining collaborators", () => {
    const merged = mergeMentionCandidates(
      [{ login: "zed" }, { login: "alice" }],
      [
        { login: "alice", name: "Alice Example", avatarUrl: "https://a/alice" },
        { login: "bob", name: "Bob Builder", avatarUrl: "https://a/bob" },
        { login: "zed", avatarUrl: "https://a/zed" },
      ],
    );
    expect(merged).toEqual([
      // Participant order preserved — order is the autocomplete ranking.
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

  it("passes an empty roster through untouched (participants-only fallback)", () => {
    expect(mergeMentionCandidates([{ login: "alice" }], [])).toEqual([
      { login: "alice" },
    ]);
  });
});
