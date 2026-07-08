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
  return {
    ...actual,
    markSnapshotCommentsSubmitted: vi.fn(),
    persistReplyDraft: vi.fn(),
  };
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

const planQueryCalls = { count: () => 0 };

function plan(results: ConversationResult[]): ConversationPlan {
  let call = 0;
  planQueryCalls.count = () => call;
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
    postReply: vi.fn(async () => ({ kind: "posted", commentId: 1 }) as const),
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
    announce: vi.fn(),
    replyDrafts: {},
    setReplyDraft: vi.fn(),
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

async function openThread() {
  const row = await screen.findByRole("button", {
    name: /This null check looks inverted/,
  });
  fireEvent.click(row);
  return row;
}

describe("ReplyComposer", () => {
  it("posts a reply, clears the draft, announces, and refetches", async () => {
    const setReplyDraft = vi.fn();
    const announce = vi.fn();
    const { props } = renderSection({
      plan: plan([ready(), ready()]),
      replyDrafts: { "9001": "a follow-up" },
      setReplyDraft,
      announce,
    });
    await openThread();
    const textarea = screen.getByLabelText(/Reply \(posts to GitHub/);
    expect((textarea as HTMLTextAreaElement).value).toBe("a follow-up");
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await waitFor(() =>
      expect(props.plan.postReply).toHaveBeenCalledWith(9001, "a follow-up"),
    );
    await waitFor(() => expect(setReplyDraft).toHaveBeenCalledWith(9001, ""));
    expect(announce).toHaveBeenCalledWith(
      "Reply posted to GitHub under your account.",
    );
    // The post-success refetch is the evict-on-write round trip: the query
    // must run again (two fetches total).
    await waitFor(() =>
      expect((planQueryCalls.count as () => number)()).toBeGreaterThanOrEqual(
        2,
      ),
    );
  });

  it("persists the draft on blur, not per keystroke (perf: local typing)", async () => {
    const setReplyDraft = vi.fn();
    renderSection({ plan: plan([ready()]), setReplyDraft });
    await openThread();
    const textarea = screen.getByLabelText(/Reply \(posts to GitHub/);
    fireEvent.change(textarea, { target: { value: "half a thought" } });
    // Typing stays local — no store churn per keystroke.
    expect(setReplyDraft).not.toHaveBeenCalled();
    fireEvent.blur(textarea);
    expect(setReplyDraft).toHaveBeenCalledWith(9001, "half a thought");
  });

  it("clears the durable draft when success settles after unmount", async () => {
    const { markSnapshotCommentsSubmitted: _flip, persistReplyDraft } =
      await import("../../../review/session");
    const durable = vi.mocked(persistReplyDraft);
    durable.mockClear();
    const release: {
      fn: ((value: { kind: "posted"; commentId: number }) => void) | null;
    } = { fn: null };
    const slowPlan = plan([ready()]);
    (slowPlan.postReply as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((resolve) => {
          release.fn = resolve;
        }),
    );
    const { view } = renderSection({
      plan: slowPlan,
      replyDrafts: { "9001": "in flight" },
    });
    await openThread();
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    view.unmount();
    release.fn?.({ kind: "posted", commentId: 1 });
    await waitFor(() =>
      expect(durable).toHaveBeenCalledWith("db:42:7:base:head", 9001, ""),
    );
  });

  it("re-persists visible text after an external draft reset (Clear local drafts)", async () => {
    const setReplyDraft = vi.fn();
    const { view, props } = renderSection({
      plan: plan([ready()]),
      replyDrafts: { "9001": "still visible" },
      setReplyDraft,
    });
    await openThread();
    // Simulate Clear local drafts: the STORE empties while the composer
    // still shows the text — behavior must follow visible state.
    view.rerender(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ConversationSection {...props} replyDrafts={{}} />
      </QueryClientProvider>,
    );
    view.unmount();
    expect(setReplyDraft).toHaveBeenCalledWith(9001, "still visible");
  });

  it("persists an unsynced draft on unmount (navigation survival)", async () => {
    const setReplyDraft = vi.fn();
    const { view } = renderSection({ plan: plan([ready()]), setReplyDraft });
    await openThread();
    const textarea = screen.getByLabelText(/Reply \(posts to GitHub/);
    fireEvent.change(textarea, { target: { value: "leaving mid-thought" } });
    view.unmount();
    expect(setReplyDraft).toHaveBeenCalledWith(9001, "leaving mid-thought");
  });

  it("keeps the draft and announces on failure (indeterminate copy on throw)", async () => {
    const setReplyDraft = vi.fn();
    const announce = vi.fn();
    const failingPlan = plan([ready()]);
    (failingPlan.postReply as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("boom"),
    );
    renderSection({
      plan: failingPlan,
      replyDrafts: { "9001": "risky reply" },
      setReplyDraft,
      announce,
    });
    await openThread();
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await waitFor(() =>
      expect(announce).toHaveBeenCalledWith(
        expect.stringContaining("may or may not have posted"),
      ),
    );
    expect(setReplyDraft).not.toHaveBeenCalledWith(9001, "");
    expect(screen.getByRole("alert").textContent).toContain(
      "may or may not have posted",
    );
  });

  it("blocks an over-cap reply with associated error copy (mirrored 400)", async () => {
    renderSection({
      plan: plan([ready()]),
      replyDrafts: { "9001": "x".repeat(65_537) },
    });
    await openThread();
    const textarea = screen.getByLabelText(/Reply \(posts to GitHub/);
    expect(textarea.getAttribute("aria-invalid")).toBe("true");
    expect(textarea.getAttribute("aria-describedby")).toBe("reply-9001-error");
    const alert = screen.getByRole("alert");
    expect(alert.id).toBe("reply-9001-error");
    expect(alert.textContent).toContain("longer than GitHub allows");
    const button = screen.getByRole("button", { name: "Reply" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
  });

  it("keeps focus on the Reply button through posting (focusable-disabled)", async () => {
    renderSection({
      plan: plan([ready(), ready()]),
      replyDrafts: { "9001": "a follow-up" },
    });
    await openThread();
    const button = screen.getByRole("button", { name: "Reply" });
    (button as HTMLButtonElement).focus();
    fireEvent.click(button);
    // Never hard-disabled: focus survives the pending and posted states.
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Reply" })
          .getAttribute("aria-disabled"),
      ).toBe("true"),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Reply" }),
    );
  });

  it("blocks an empty reply (button disabled)", async () => {
    renderSection({ plan: plan([ready()]) });
    await openThread();
    const button = screen.getByRole("button", { name: "Reply" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});
