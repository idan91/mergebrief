// @vitest-environment jsdom
// The in-flow conversation section (BRIEF-25): verdict strip + digest over
// canned query data. Pins the a11y contract (disclosure buttons carry
// aria-expanded; chips carry text), expansion surviving refetch (visible
// state, never entry-path memory), the specific error states, the teaching
// empty state, and the reconciliation flip (server-backed wins).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as SessionModule from "../../../review/session";

import type { BriefChunk } from "../../../brief/types";
import type { ReviewComment } from "../../../review/comments";
import type { ConversationResult } from "../../queries";
import type { PrConversation } from "../../types";
import {
  ConversationSection,
  type ConversationPlan,
  type ConversationSectionProps,
} from "./ConversationSection";

vi.mock("../../../review/session", async (importOriginal) => {
  const actual = await importOriginal<typeof SessionModule>();
  return { ...actual, markSnapshotCommentsSubmitted: vi.fn() };
});

afterEach(cleanup);

function chunk(id: string, file: string): BriefChunk {
  return {
    id,
    changeGroupId: "g1",
    file,
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
  return {
    threads: [
      {
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
      },
      {
        rootCommentId: 9002,
        path: "src/a.ts",
        line: 10,
        side: "RIGHT",
        subjectType: "LINE",
        isResolved: true,
        isOutdated: false,
        comments: [
          {
            commentId: 9002,
            author: { login: "coderabbitai", isBot: true },
            body: "Consider a guard clause.",
            createdAt: "2026-07-01T11:00:00Z",
            url: "https://example.test/c/9002",
          },
        ],
        hasMoreComments: false,
      },
    ],
    reviews: [
      {
        reviewId: 500,
        author: { login: "alice", isBot: false },
        state: "CHANGES_REQUESTED",
        body: "needs work",
        submittedAt: "2026-07-01T10:00:00Z",
        url: "https://example.test/r/500",
      },
    ],
    prComments: [],
    hasMoreThreads: false,
    hasMoreReviews: false,
    hasMorePrComments: false,
  };
}

function plan(results: ConversationResult[]): ConversationPlan {
  let call = 0;
  const descriptor = {
    queryKey: ["conversation", "42", 7] as const,
    queryFn: async () => {
      const result = results[Math.min(call, results.length - 1)];
      call += 1;
      if (result === undefined) throw new Error("plan exhausted");
      return result;
    },
    staleTime: 0,
    retry: false,
  };
  // Structural stand-in for the real descriptor (test-only escape hatch).
  return {
    queryOptions: descriptor as unknown as ConversationPlan["queryOptions"],
  };
}

function renderSection(
  overrides: Partial<ConversationSectionProps> & { plan: ConversationPlan },
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const props: ConversationSectionProps = {
    briefId: "db:42:7:base:head",
    chunks: [chunk("c1", "src/a.ts")],
    localComments: [],
    submittedReviewIds: [],
    jumpToChunk: vi.fn(),
    markCommentsSubmitted: vi.fn(),
    ...overrides,
  };
  const view = render(
    <QueryClientProvider client={client}>
      <ConversationSection {...props} />
    </QueryClientProvider>,
  );
  return { client, props, view };
}

function ready(): ConversationResult {
  return { kind: "ready", conversation: conversation() };
}

describe("ConversationSection", () => {
  it("renders the verdict strip and text-carrying thread chips", async () => {
    renderSection({ plan: plan([ready()]) });
    expect(await screen.findByText("changes requested")).toBeDefined();
    expect(screen.getAllByText("@alice").length).toBeGreaterThan(0);
    // Chips are text, not color-only.
    expect(screen.getByText("open")).toBeDefined();
  });

  it("expands a thread row via aria-expanded disclosure and jumps to its chunk", async () => {
    const { props } = renderSection({ plan: plan([ready()]) });
    const row = await screen.findByRole("button", {
      name: /This null check looks inverted/,
    });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Jump to chunk" }));
    expect(props.jumpToChunk).toHaveBeenCalledWith("c1");
  });

  it("keeps expansion across a refetch (state, not entry-path memory)", async () => {
    const { client } = renderSection({ plan: plan([ready(), ready()]) });
    const row = await screen.findByRole("button", {
      name: /This null check looks inverted/,
    });
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    await client.invalidateQueries();
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: /This null check looks inverted/ })
          .getAttribute("aria-expanded"),
      ).toBe("true"),
    );
  });

  it("aggregates bot threads into one disclosure per bot author", async () => {
    renderSection({ plan: plan([ready()]) });
    const botRow = await screen.findByRole("button", {
      name: /coderabbitai.*1 threads.*0 open/,
    });
    fireEvent.click(botRow);
    expect(
      screen.getByRole("button", { name: /Consider a guard clause/ }),
    ).toBeDefined();
  });

  it("keeps the collapsed bot-group chip factual for all-outdated groups", async () => {
    const base = conversation();
    const botThread = base.threads[1];
    if (botThread === undefined) throw new Error("fixture");
    const payload: PrConversation = {
      ...base,
      threads: [
        {
          ...botThread,
          isOutdated: true,
          // Unresolved AND outdated: the group chip must still read
          // outdated, not open (codex round 2).
          isResolved: false,
        },
      ],
    };
    // Outdated threads drop their line on the wire.
    const outdatedPayload: PrConversation = {
      ...payload,
      threads: payload.threads.map((thread) => {
        const { line: _line, side: _side, ...rest } = thread;
        return rest;
      }),
    };
    renderSection({
      plan: plan([{ kind: "ready", conversation: outdatedPayload }]),
    });
    const botRow = await screen.findByRole("button", {
      name: /coderabbitai/,
    });
    expect(botRow.textContent).toContain("outdated");
  });

  it("announces error states via role=alert", async () => {
    renderSection({ plan: plan([{ kind: "unavailable" }]) });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("unreachable");
  });

  it("shows the teaching empty state", async () => {
    renderSection({
      plan: plan([
        {
          kind: "ready",
          conversation: {
            threads: [],
            reviews: [],
            prComments: [],
            hasMoreThreads: false,
            hasMoreReviews: false,
            hasMorePrComments: false,
          },
        },
      ]),
    });
    expect(
      await screen.findByText(/comments land here as teammates review/),
    ).toBeDefined();
  });

  it("shows specific copy per failure kind", async () => {
    renderSection({ plan: plan([{ kind: "unavailable" }]) });
    expect(
      await screen.findByText(/GitHub \(or the backend\) is unreachable/),
    ).toBeDefined();
    cleanup();
    renderSection({ plan: plan([{ kind: "unauthorized" }]) });
    expect(await screen.findByText(/session expired/)).toBeDefined();
    cleanup();
    renderSection({ plan: plan([{ kind: "not-found" }]) });
    expect(
      await screen.findByText(/no longer accessible on\s+GitHub/),
    ).toBeDefined();
    cleanup();
    // A thrown queryFn (malformed 200) renders the unexpected-response copy.
    const throwing = plan([{ kind: "unavailable" }]);
    (throwing.queryOptions as { queryFn: unknown }).queryFn = async () => {
      throw new Error("malformed");
    };
    renderSection({ plan: throwing });
    expect(await screen.findByText(/unexpected response/)).toBeDefined();
  });

  it("shares the ~50-row budget between thread rows and PR-level comments", async () => {
    const base = conversation();
    const manyThreads = Array.from({ length: 50 }, (_, index) => ({
      ...base.threads[0]!,
      rootCommentId: 20_000 + index,
      comments: [
        { ...base.threads[0]!.comments[0]!, commentId: 20_000 + index },
      ],
    }));
    const payload: PrConversation = {
      ...base,
      // All threads unanchored (general group) so they compete with the
      // PR-level comments for one budget.
      threads: manyThreads.map((thread) => ({
        ...thread,
        path: "src/not-in-brief.ts",
      })),
      prComments: [
        {
          commentId: 30_001,
          author: { login: "carol", isBot: false },
          body: "beyond the budget",
          createdAt: "2026-07-02T09:00:00Z",
          url: "https://example.test/i/30001",
        },
      ],
    };
    renderSection({ plan: plan([{ kind: "ready", conversation: payload }]) });
    await screen.findAllByRole("button", { name: /This null check/ });
    // 50 thread rows consume the budget: the PR comment hides behind
    // Show more and reveals on click.
    expect(screen.queryByText(/beyond the budget/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show 1 more/ }));
    expect(screen.getByText(/beyond the budget/)).toBeDefined();
  });

  it("flips drafts the reconciliation proved posted (server-backed wins)", async () => {
    const localDraft: ReviewComment = {
      id: "ghost-draft",
      anchor: {
        chunkId: "c1",
        file: "src/a.ts",
        side: "new",
        startLine: 10,
        endLine: 10,
        rowIds: ["c1:1"],
        selectedText: "b",
      },
      body: "This null check looks inverted.",
      status: "draft",
      collapsed: false,
    };
    const withOwn = conversation();
    const ownThread = withOwn.threads[0];
    if (ownThread === undefined) throw new Error("fixture");
    const ownPayload: PrConversation = {
      ...withOwn,
      threads: [
        {
          ...ownThread,
          comments: [{ ...ownThread.comments[0]!, reviewId: 500 }],
        },
        ...withOwn.threads.slice(1),
      ],
    };
    const { props } = renderSection({
      plan: plan([{ kind: "ready", conversation: ownPayload }]),
      localComments: [localDraft],
      submittedReviewIds: [500],
    });
    await waitFor(() =>
      expect(props.markCommentsSubmitted).toHaveBeenCalledWith(["ghost-draft"]),
    );
    // The own thread carries the "yours" tag.
    expect(screen.getByText("yours")).toBeDefined();
  });
});
