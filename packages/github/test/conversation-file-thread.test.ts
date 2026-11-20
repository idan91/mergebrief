// A file-level thread anchors to no line, whatever number GitHub reports.
import type { Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";

import { fetchPullRequestConversation } from "../src/operations/conversation";
import {
  conversationResponse,
  gqlComment,
  gqlThread,
} from "./fixtures/conversation-graphql";

const INPUT = { owner: "o", repo: "r", prNumber: 7 } as const;

function stubGraphqlOctokit(response: unknown): Octokit {
  const stub = { graphql: vi.fn().mockResolvedValue(response) };
  // Structural stand-in where the full `Octokit` type is expected.
  return stub as unknown as Octokit;
}

describe("fetchPullRequestConversation, file-level threads", () => {
  it("drops the line GitHub reports for a file-level thread", async () => {
    const result = await fetchPullRequestConversation(
      stubGraphqlOctokit(
        conversationResponse({
          threads: [
            gqlThread({
              subjectType: "FILE",
              line: 1,
              comments: [gqlComment({ login: "alice" })],
            }),
          ],
        }),
      ),
      INPUT,
    );

    if (!result.ok) {
      throw new Error("unreachable");
    }
    const thread = result.value.threads[0];
    expect(thread?.subjectType).toBe("FILE");
    expect(thread?.line).toBeUndefined();
    expect(thread?.startLine).toBeUndefined();
  });
});
