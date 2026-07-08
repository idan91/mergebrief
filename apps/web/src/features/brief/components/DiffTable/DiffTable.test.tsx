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

function renderTable(overrides: Partial<DiffTableProps> = {}) {
  const rows =
    buildInlineThreads({
      conversation: conversation(),
      chunks: [chunk()],
      ownThreadIds: new Set(),
    }).get("c1") ?? [];
  const openCommentComposer = vi.fn();
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
    openCommentComposer,
    reviewCommentLabel: "review comment",
    saveReviewComment: vi.fn(),
    toggleReviewComment: vi.fn(),
    updateReviewComment: vi.fn(),
    ...overrides,
  };
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <DiffTable {...props} />
    </QueryClientProvider>,
  );
  return { view, openCommentComposer };
}

describe("DiffTable — read-only comment affordances (BRIEF-24)", () => {
  const REASON = "You're viewing an earlier revision.";

  it("rows stay focusable but are aria-disabled with a reachable reason", () => {
    const { view } = renderTable({ composerDisabledReason: REASON });
    const row = view.container.querySelector('tr[aria-disabled="true"]');
    expect(row).not.toBeNull();
    // Still keyboard-reachable — the reason is discoverable BEFORE activation.
    expect(row?.getAttribute("tabindex")).toBe("0");
    const reasonId = row?.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(reasonId)?.textContent).toBe(REASON);
    // The hover cue drops with the affordance.
    expect(view.container.querySelector("[data-commentable]")).toBeNull();
  });

  it("keeps composer entry inert on activation (Enter and click)", () => {
    const { view, openCommentComposer } = renderTable({
      composerDisabledReason: REASON,
    });
    const row = view.container.querySelector('tr[aria-disabled="true"]');
    if (!(row instanceof HTMLElement)) throw new Error("expected a diff row");
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.mouseDown(row);
    fireEvent.mouseUp(row);
    expect(openCommentComposer).not.toHaveBeenCalled();
  });

  it("stays writable when no reason is given", () => {
    const { view, openCommentComposer } = renderTable();
    const row = view.container.querySelector("tr[data-commentable]");
    if (!(row instanceof HTMLElement)) throw new Error("expected a diff row");
    expect(row.getAttribute("aria-disabled")).toBeNull();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(openCommentComposer).toHaveBeenCalled();
  });
});

describe("DiffTable — row-level conversation threads", () => {
  it("renders the thread under its line with the jump-target attribute", () => {
    const {
      view: { container },
    } = renderTable();
    const row = container.querySelector('[data-conversation-thread="9001"]');
    expect(row).not.toBeNull();
    // The inline render must NOT emit the SECTION's landing attribute — and
    // vice versa the section row never carries `data-conversation-thread` —
    // or one would shadow the other in document order (codex round 5).
    expect(
      container.querySelector("[data-conversation-section-thread]"),
    ).toBeNull();
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
