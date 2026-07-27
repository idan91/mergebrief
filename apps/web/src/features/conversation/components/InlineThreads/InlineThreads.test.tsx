// @vitest-environment jsdom
// Inline threads at a chunk (BRIEF-25): same disclosure pattern as the
// section (aria-expanded buttons), bots aggregated into one disclosure per
// author, and the detail hides its jump button (the rows already sit at
// their chunk).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Brief, BriefChunk } from "@web/features/brief/types";
import { buildBriefViewModel } from "@web/features/brief/utils";
import {
  createReviewFlowStore,
  MindMapProvider,
  ReviewFlowProvider,
} from "@web/features/review/session";
import { buildInlineThreads } from "../../utils/digest";
import type { ConversationThread, PrConversation } from "../../types";
import type { ThreadComposerWiring } from "../../wiring";
import { InlineThreads } from "./InlineThreads";

// One ordered hook: cleanup() unmounts the MindMapProvider, whose teardown
// FLUSHES a pending snapshot write — the storage clear must run after it, or
// one test's drafts hydrate into the next (every test shares a briefId).
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

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
      { kind: "add", content: "b", newLine: 10 },
      { kind: "add", content: "c", newLine: 11 },
    ],
  } as BriefChunk;
}

let nextId = 5000;
function thread(overrides: {
  line: number;
  login?: string;
  isBot?: boolean;
  isResolved?: boolean;
  body?: string;
}): ConversationThread {
  nextId += 1;
  return {
    rootCommentId: nextId,
    path: "src/a.ts",
    line: overrides.line,
    side: "RIGHT",
    subjectType: "LINE",
    isResolved: overrides.isResolved ?? false,
    isOutdated: false,
    comments: [
      {
        commentId: nextId,
        author: {
          login: overrides.login ?? "alice",
          isBot: overrides.isBot ?? false,
        },
        body: overrides.body ?? "a note",
        createdAt: "2026-07-01T10:00:00Z",
        url: `https://example.test/c/${nextId}`,
      },
    ],
    hasMoreComments: false,
  };
}

function conversation(threads: ConversationThread[]): PrConversation {
  return {
    threads,
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
    onPosted: vi.fn(),
  };
}

const providerBrief: Brief = {
  artifactKind: "brief",
  pr: {
    repo: "acme/widgets",
    number: 7,
    title: "t",
    url: "https://example.com/pr/7",
    sha: "head1234",
    description: "",
  },
  summary: "s",
  changeGroups: [
    {
      id: "g1",
      title: "g",
      summary: "g",
      dominantCategory: "bugfix",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [chunk()],
  concernView: [],
};

function renderInline(threads: ConversationThread[]) {
  const rows =
    buildInlineThreads({
      conversation: conversation(threads),
      chunks: [chunk()],
      ownThreadIds: new Set(),
    }).get("c1") ?? [];
  // The reply composer inside an expanded detail reads the session stores.
  const flowStore = createReviewFlowStore(
    {
      saveComment: vi.fn(),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
      toggleComment: vi.fn(),
    },
    {
      composerDisabledReason: undefined,
      flagsReadOnly: false,
      postingCommentIds: new Set(),
      postBlockedExternally: undefined,
      postComment: undefined,
    },
  );
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MindMapProvider
        briefId="db:42:7:base:head"
        model={buildBriefViewModel(providerBrief)}
      >
        <ReviewFlowProvider store={flowStore}>
          <InlineThreads composer={composer()} rows={rows} />
        </ReviewFlowProvider>
      </MindMapProvider>
    </QueryClientProvider>,
  );
}

describe("InlineThreads", () => {
  it("renders human threads as aria-expanded disclosures without a jump button", () => {
    renderInline([thread({ line: 10, body: "human inline note" })]);
    const row = screen.getByRole("button", { name: /human inline note/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    // The detail sits at its chunk already: no jump control.
    expect(screen.queryByRole("button", { name: "Jump to chunk" })).toBeNull();
    // The composer is present (replies from the chunk).
    expect(screen.getByLabelText(/Reply \(posts to GitHub/)).toBeDefined();
  });

  it("aggregates bot threads into one disclosure per author", () => {
    renderInline([
      thread({ line: 10, login: "coderabbitai", isBot: true, body: "bot one" }),
      thread({ line: 11, login: "coderabbitai", isBot: true, body: "bot two" }),
    ]);
    const botRow = screen.getByRole("button", {
      name: /coderabbitai.*2 open threads/,
    });
    fireEvent.click(botRow);
    expect(screen.getByRole("button", { name: /bot one/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /bot two/ })).toBeDefined();
  });

  it("renders nothing for an empty row set", () => {
    const { container } = renderInline([]);
    expect(container.querySelector("section")).toBeNull();
  });
});
