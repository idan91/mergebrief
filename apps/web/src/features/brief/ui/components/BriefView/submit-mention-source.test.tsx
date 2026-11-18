// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { appI18n } from "../../../../../i18n/I18nProvider";

import type { ConversationPlan } from "@web/features/conversation";
import { mountBriefView } from "@web/features/brief/test-utils";

const CONTINUE_TO_VERDICT = appI18n.t("review.submit.continueAction");
const REVIEW_COMMENT_LABEL = appI18n.t("review.submit.commentLabel");

/** A plan whose conversation has one participant and no repo to search. */
function stubPlan(): ConversationPlan {
  const plan = {
    queryOptions: {
      queryKey: ["conversation", "42", 7],
      queryFn: async () => ({
        kind: "ready",
        conversation: {
          threads: [
            {
              rootCommentId: 7001,
              path: "src/leak.ts",
              line: 10,
              side: "RIGHT",
              subjectType: "LINE",
              isResolved: false,
              isOutdated: false,
              comments: [
                {
                  commentId: 7001,
                  author: { login: "carol", isBot: false },
                  body: "Looks close.",
                  createdAt: "2026-07-01T10:00:00Z",
                  url: "https://example.test/c/7001",
                },
              ],
              hasMoreComments: false,
            },
          ],
          reviews: [],
          prComments: [],
          hasMoreThreads: false,
          hasMoreReviews: false,
          hasMorePrComments: false,
        },
      }),
      retry: false,
    },
    postReply: vi.fn(),
    briefGeneratedAt: "2026-07-01T12:00:00Z",
  };
  return plan as unknown as ConversationPlan;
}

describe("BriefView submit modal mention source", () => {
  it("offers the conversation's participants in the review comment", async () => {
    await mountBriefView({ conversation: stubPlan() });
    await screen.findByRole("button", { name: /Looks close/ });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    fireEvent.click(screen.getByRole("button", { name: CONTINUE_TO_VERDICT }));

    fireEvent.change(screen.getByLabelText(REVIEW_COMMENT_LABEL), {
      target: { value: "@" },
    });
    expect(
      screen.getAllByRole("option").map((option) => option.textContent?.trim()),
    ).toEqual(["@carol"]);
  });
});
