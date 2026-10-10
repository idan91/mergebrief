// @vitest-environment jsdom
// A reply posted from either composer must read as the reviewer's own once
// the conversation refetches, which only holds while the screen hands both
// composers the plan that records the reply's review id.
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationPlan } from "@web/features/conversation";
import type { ConversationComment } from "@web/features/conversation/types";
import { mountBriefView } from "../../test-utils";

const THREAD_ID = 9001;
const REPLY_BODY = "my own follow-up";
const REPLY_REVIEW_ID = 555;

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  sessionStorage.setItem(
    `mergebrief.replyDraft.${String(THREAD_ID)}`,
    REPLY_BODY,
  );
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function makeComment(
  commentId: number,
  body: string,
  createdAt: string,
): ConversationComment {
  return {
    commentId,
    author: { login: "alice", isBot: false },
    body,
    createdAt,
    url: `https://example.test/c/${String(commentId)}`,
  };
}

/** A plan whose conversation gains the reply, newer than the brief, on post. */
function stubPlan(): ConversationPlan {
  const comments: ConversationComment[] = [
    makeComment(
      THREAD_ID,
      "This check looks inverted.",
      "2026-07-01T10:00:00Z",
    ),
  ];
  const readConversation = () => ({
    kind: "ready",
    conversation: {
      threads: [
        {
          rootCommentId: THREAD_ID,
          path: "src/leak.ts",
          line: 10,
          side: "RIGHT",
          subjectType: "LINE",
          isResolved: false,
          isOutdated: false,
          comments: [...comments],
          hasMoreComments: false,
        },
      ],
      reviews: [],
      prComments: [],
      hasMoreThreads: false,
      hasMoreReviews: false,
      hasMorePrComments: false,
    },
  });
  const postReply = vi.fn(async (_threadId: number, body: string) => {
    comments.push({
      ...makeComment(9002, body, "2026-07-01T13:00:00Z"),
      reviewId: REPLY_REVIEW_ID,
    });
    return { kind: "posted", commentId: 9002, reviewId: REPLY_REVIEW_ID };
  });
  const plan = {
    queryOptions: {
      queryKey: ["conversation", "42", 7],
      queryFn: async () => readConversation(),
      retry: false,
    },
    postReply,
    briefGeneratedAt: "2026-07-01T12:00:00Z",
  };
  // Structural stand-in for the real plan (test-only escape hatch).
  return plan as unknown as ConversationPlan;
}

async function postReplyFrom(threadRow: HTMLElement) {
  fireEvent.click(threadRow);
  await screen.findByLabelText(/Reply \(posts to GitHub/);
  fireEvent.click(screen.getByRole("button", { name: "Reply" }));
  // The refetched thread, not the composer's own echo of the draft.
  await screen.findAllByText("2 comments");
  expect(screen.getAllByText(REPLY_BODY).length).toBeGreaterThan(0);
}

describe("BriefScreen, a reply posted from the brief", () => {
  it("is not marked new when posted under the diff", async () => {
    await mountBriefView({ conversation: stubPlan() });
    const inlineRow = await screen.findByRole("button", {
      name: /This check looks inverted/,
    });

    await postReplyFrom(inlineRow);

    expect(screen.queryByText("new since this brief")).toBeNull();
  });

  it("is not marked new when posted from the Conversation section", async () => {
    await mountBriefView({ conversation: stubPlan() });
    fireEvent.click(
      await screen.findByRole("button", { name: /Conversation/ }),
    );
    const section = await screen.findByRole("region", { name: /Conversation/ });
    const sectionRow = await within(section).findByRole("button", {
      name: /This check looks inverted/,
    });

    await postReplyFrom(sectionRow);

    expect(screen.queryByText("new since this brief")).toBeNull();
  });
});
