import { describe, expect, it } from "vitest";

import type { ConversationThread } from "../types";
import { mentionCandidatesFromThread } from "./mentions";

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
    ).toEqual(["alice", "bob"]);
  });
});
