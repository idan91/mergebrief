// @vitest-environment jsdom
// Row-level conversation threads inside the diff (BRIEF-25 post-smoke): a
// human thread renders under its own line as a disclosure, the row carries
// the data-conversation-thread hook the digest's "Jump to comment" descends
// to, and the detail hides its jump (the row already IS the destination).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ThreadComposerWiring } from "../../../conversation/components/ConversationSection/ConversationSection";
import {
  buildInlineThreads,
  splitInlineRows,
} from "../../../conversation/digest";
import type {
  ConversationThread,
  PrConversation,
} from "../../../conversation/types";
import type { BriefChunk } from "../../types";
import { DiffTable, type DiffTableProps } from "./DiffTable";

afterEach(cleanup);

function chunk(): BriefChunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/a.ts",
    concern: "implementation",
    role: "carrier",
    loc: { added: 1, deleted: 0 },
    addedRanges: [],
    removedRanges: [],
    riskSurface: [],
    diff: [
      { kind: "ctx", content: "a", oldLine: 9, newLine: 9 },
      { kind: "add", content: "b", newLine: 10 },
    ],
  } as BriefChunk;
}

function conversation(): PrConversation {
  const thread: ConversationThread = {
    rootCommentId: 9001,
    path: "src/a.ts",
    line: 10,
    side: "RIGHT",
    subjectType: "LINE",
    isResolved: false,
    isOutdated: false,
    comments: [
      {
        commentId: 9001,
        author: { login: "alice", isBot: false },
        body: "This null check looks inverted.",
        createdAt: "2026-07-01T10:00:00Z",
        url: "https://example.test/c/9001",
      },
    ],
    hasMoreComments: false,
  };
  return {
    threads: [thread],
    reviews: [],
    prComments: [],
    hasMoreThreads: false,
    hasMoreReviews: false,
    hasMorePrComments: false,
  };
}

function composer(): ThreadComposerWiring {
  return {
    briefId: "db:42:7:base:head",
    post: vi.fn(async () => ({ kind: "posted", commentId: 1 }) as const),
    announce: vi.fn(),
    getDraft: () => "",
    setDraft: vi.fn(),
    onPosted: vi.fn(),
  };
}

function renderTable() {
  const rows =
    buildInlineThreads({
      conversation: conversation(),
      chunks: [chunk()],
      ownThreadIds: new Set(),
    }).get("c1") ?? [];
  const props: DiffTableProps = {
    chunk: chunk(),
    comparisonView: { marks: new Map(), runs: [], runByRow: new Map() },
    comparisonSource: { kind: "last-review", delta: null },
    comparisonSkipReason: null,
    activeCommentAnchor: null,
    addressedComments: [],
    conversationThreadsByRow: splitInlineRows(rows).byRow,
    conversationComposer: composer(),
    cancelCommentComposer: vi.fn(),
    comments: [],
    deleteReviewComment: vi.fn(),
    existingReviewCommentCount: 0,
    openCommentComposer: vi.fn(),
    reviewCommentLabel: "review comment",
    saveReviewComment: vi.fn(),
    toggleReviewComment: vi.fn(),
    updateReviewComment: vi.fn(),
  };
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <DiffTable {...props} />
    </QueryClientProvider>,
  );
}

describe("DiffTable — row-level conversation threads", () => {
  it("renders the thread under its line with the jump-target attribute", () => {
    const { container } = renderTable();
    const row = container.querySelector('[data-conversation-thread="9001"]');
    expect(row).not.toBeNull();
    // The disclosure inside the row is the focus target of the jump.
    const disclosure = screen.getByRole("button", {
      name: /This null check looks inverted/,
    });
    expect(row?.contains(disclosure)).toBe(true);
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    // Row-level detail hides the jump — the row already is the destination.
    expect(screen.queryByRole("button", { name: /Jump to/ })).toBeNull();
  });
});
