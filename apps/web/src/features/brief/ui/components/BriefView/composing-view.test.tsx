// @vitest-environment jsdom
import type { ConversationCommentView } from "contract";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appI18n } from "../../../../../i18n/I18nProvider";

import { Button } from "@web/components/Button";
import type { ConversationPlan } from "@web/features/conversation";
import {
  emptySessionPayload,
  type ReviewSessionPayload,
} from "@web/features/review/session";
import {
  SubmitReviewResultKinds,
  type SubmitDraftInput,
  type SubmitReviewResult,
} from "../../../../review/utils";
import type { BriefSearchParams } from "../../../model/comparison/compare-state";
import type { ComparisonMarks } from "../../../model/types";
import {
  briefFixture,
  FixtureBriefView,
  mountBriefHost,
  mountBriefView,
} from "@web/features/brief/test-utils";
import { createFileRowsCache } from "../../../model/file-rows/cache";

const previousBriefMarks: ComparisonMarks = {
  baselineSha: "prev1234",
  headSha: briefFixture.pr.sha,
  baselineLabel: "previous-brief",
  baselineIndex: 1,
  files: [],
};

/** The fixture's flagged chunk owns src/leak.ts lines 10 to 13. */
const LEAK_PATCH = [
  "diff --git a/src/leak.ts b/src/leak.ts",
  "--- a/src/leak.ts",
  "+++ b/src/leak.ts",
  "@@ -9,2 +9,6 @@",
  " const before = 1;",
  "+guard(a);",
  "+guard(b);",
  "+guard(c);",
  "+guard(d);",
  " const after = 2;",
].join("\n");

const FILE_ROWS = createFileRowsCache(new Map([["src/leak.ts", LEAK_PATCH]]));

function Harness() {
  const [search, setSearch] = useState<BriefSearchParams>({
    view: "changes",
    compare: "previous-brief",
  });

  return (
    <>
      <Button
        onClick={() => setSearch({ view: "full", compare: "previous-brief" })}
      >
        to full
      </Button>
      <Button
        onClick={() =>
          setSearch({ view: "changes", compare: "previous-brief" })
        }
      >
        to changes
      </Button>
      <FixtureBriefView
        comparisonPlan={{
          previousBrief: {
            marks: {
              queryKey: ["test-previous-marks"],
              queryFn: () => Promise.resolve(previousBriefMarks),
            },
            rawDiff: {
              queryKey: ["test-raw-diff"],
              queryFn: () => Promise.resolve(LEAK_PATCH),
            },
          },
        }}
        exitChangesScope={() =>
          setSearch({ view: "full", compare: "previous-brief" })
        }
        fileRows={FILE_ROWS}
        searchParams={search}
      />
    </>
  );
}

function findSpanRow(): HTMLElement {
  const row = document.querySelector("details tr[data-commentable]");
  if (!(row instanceof HTMLElement)) {
    throw new Error("expected a commentable span row");
  }
  return row;
}

const THREAD_ID = 9001;
const REPLY_BODY = "my own follow-up";
const REPLY_REVIEW_ID = 555;

function makeComment(
  commentId: number,
  body: string,
  createdAt: string,
): ConversationCommentView {
  return {
    commentId,
    author: { login: "alice", isBot: false },
    body,
    createdAt,
    url: `https://example.test/c/${String(commentId)}`,
  };
}

async function postReplyFrom(threadRow: HTMLElement) {
  fireEvent.click(threadRow);
  await screen.findByLabelText(/Reply \(posts to GitHub/);
  fireEvent.click(screen.getByRole("button", { name: "Reply" }));
  // The refetched thread, not the composer's own echo of the draft.
  await screen.findAllByText("2 comments");
  expect(screen.getAllByText(REPLY_BODY).length).toBeGreaterThan(0);
}

const CONTINUE_TO_VERDICT = appI18n.t("review.submit.continueAction");
const REVIEW_COMMENT_LABEL = appI18n.t("review.submit.commentLabel");
const OUTCOME_LEGEND = appI18n.t("review.submit.outcomeLegend");

function buildSessionPayload(
  reviewOutcome: ReviewSessionPayload["reviewOutcome"],
): ReviewSessionPayload {
  return {
    materialized: true,
    attention: [],
    reviewOutcome,
    draftComments: [],
    readMarks: [],
    reclassifications: [],
    dispositions: [],
    submittedReviewIds: [],
  };
}

function stubSubmitReview() {
  return vi.fn<(draft: SubmitDraftInput) => Promise<SubmitReviewResult>>(() =>
    Promise.resolve({
      kind: SubmitReviewResultKinds.SUBMITTED,
      reviewId: 1,
      commentsFolded: 0,
      commentsTotal: 0,
    }),
  );
}

async function openSubmitModal(
  reviewOutcome: ReviewSessionPayload["reviewOutcome"],
  viewerIsAuthor = false,
) {
  const submitReview = stubSubmitReview();
  await mountBriefView({
    session: buildSessionPayload(reviewOutcome),
    submitReview,
    viewerIsAuthor,
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  fireEvent.click(screen.getByRole("button", { name: CONTINUE_TO_VERDICT }));
  return submitReview;
}

function readSubmitDisabled(): string | null {
  return screen
    .getByRole("button", { name: /^submit review$/i })
    .getAttribute("aria-disabled");
}

function clickSubmitReview(): void {
  fireEvent.click(screen.getByRole("button", { name: /^submit review$/i }));
}

function listCheckedOutcomes(): HTMLInputElement[] {
  return within(screen.getByRole("group", { name: OUTCOME_LEGEND }))
    .getAllByRole<HTMLInputElement>("radio")
    .filter((radio) => radio.checked);
}

// Escape must leave the composer AND give the reading shortcuts back: it
// clears `activeCommentAnchor`, and while that is set every key belongs to
// the composer. The case lives on the DB path because that is where a
// composer exists at all, a file-backed Brief has no session to write into.
describe("a comment composer and the page shortcuts", () => {
  it("keeps J/K/Z working after leaving a comment composer via Escape", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    await mountBriefView({ session: emptySessionPayload() });

    // Composer entry is gutter-only, the code column is reserved for text
    // selection.
    const gutter = document.querySelector(
      "[data-commentable] [data-comment-anchor]",
    );
    expect(gutter).toBeTruthy();
    fireEvent.mouseDown(gutter as Element);
    fireEvent.mouseUp(gutter as Element);
    await screen.findByPlaceholderText("Leave a comment");

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("Leave a comment")).toBeNull(),
    );

    const before = document.querySelector("article[data-current]")?.id;
    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() =>
      expect(document.querySelector("article[data-current]")?.id).not.toBe(
        before,
      ),
    );
  });

  it("holds the page shortcuts while a file composer is open", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    await mountBriefView({ session: emptySessionPayload() });
    const [fileControl] = screen.getAllByRole("button", {
      name: /^Add a comment on /,
    });
    fireEvent.click(fileControl as Element);
    await screen.findByPlaceholderText("Leave a comment");

    const before = document.querySelector("article[data-current]")?.id;
    fireEvent.keyDown(window, { key: "j" });

    expect(document.querySelector("article[data-current]")?.id).toBe(before);
    expect(screen.getByPlaceholderText("Leave a comment")).toBeTruthy();
  });
});

describe("a composer hosted by the hidden scope pane", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  it("is cancelled on a scope switch, so nothing stays open unseen", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    await mountBriefHost(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Raw diff" }));
    await waitFor(() => findSpanRow());

    fireEvent.keyDown(findSpanRow(), { key: "Enter" });
    expect(screen.getByPlaceholderText("Leave a comment")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "to full" }));
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("Leave a comment")).toBeNull(),
    );

    fireEvent.click(screen.getByRole("button", { name: "to changes" }));
    await waitFor(() => findSpanRow());
    expect(screen.queryByPlaceholderText("Leave a comment")).toBeNull();
  });
});

// A reply posted from either composer must read as the reviewer's own once
// the conversation refetches, which only holds while the screen hands both
// composers the plan that records the reply's review id.
describe("BriefView, a reply posted from the brief", () => {
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

  /** A plan whose conversation gains the reply, newer than the brief, on post. */
  function stubPlan(): ConversationPlan {
    const comments: ConversationCommentView[] = [
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

  it("is not marked new when posted under the diff", async () => {
    await mountBriefView({ conversation: stubPlan() });
    const inlineRow = await screen.findByRole("button", {
      name: /This check looks inverted/,
    });

    await postReplyFrom(inlineRow);

    expect(screen.queryByText("New since this brief")).toBeNull();
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

    expect(screen.queryByText("New since this brief")).toBeNull();
  });
});

describe("BriefView submit modal mention source", () => {
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

describe("the submitted review outcome", () => {
  describe("submit under a stored outcome this bundle does not know", () => {
    it("holds submit until an outcome is picked, then sends that one", async () => {
      const submitReview = await openSubmitModal("unknown");

      expect(listCheckedOutcomes()).toEqual([]);
      expect(readSubmitDisabled()).toBe("true");
      expect(screen.getByText(/pick an outcome/i)).toBeTruthy();

      clickSubmitReview();
      expect(submitReview).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("radio", { name: "Approve" }));
      expect(readSubmitDisabled()).toBeNull();
      clickSubmitReview();

      await waitFor(() => expect(submitReview).toHaveBeenCalledTimes(1));
      expect(submitReview.mock.calls[0]?.[0].outcome).toBe("approve");
    });

    it("starts a known stored outcome checked and submittable", async () => {
      await openSubmitModal("request-changes");

      expect(
        screen.getByRole<HTMLInputElement>("radio", { name: "Request changes" })
          .checked,
      ).toBe(true);
      expect(readSubmitDisabled()).toBeNull();
    });
  });

  describe("a verdict GitHub refuses", () => {
    it("points the pull request's author at Comment", async () => {
      const submitReview = await openSubmitModal("approve", true);
      submitReview.mockResolvedValue({
        kind: SubmitReviewResultKinds.UPSTREAM,
      });

      clickSubmitReview();

      expect(
        await screen.findByText(/GitHub does not let an author approve/),
      ).toBeTruthy();
    });
  });
});
