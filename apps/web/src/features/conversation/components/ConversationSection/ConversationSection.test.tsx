// @vitest-environment jsdom
// The in-flow conversation section (BRIEF-25): verdict strip + digest over
// canned query data. Pins the a11y contract (disclosure buttons carry
// aria-expanded; chips carry text), expansion surviving refetch (visible
// state, never entry-path memory), the specific error states, the teaching
// empty state, and the reconciliation flip (server-backed wins).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as SessionModule from "@web/features/review/session";

import type { Brief, BriefChunk } from "@web/features/brief/types";
import { buildBriefViewModel } from "@web/features/brief/utils";
import type { ReviewComment } from "@web/features/review/utils/comments";
import {
  createReviewFlowStore,
  MindMapProvider,
  ReviewFlowProvider,
  useMindMap,
  useMindMapActions,
  type MindMapActions,
} from "@web/features/review/session";
import type { ConversationResult } from "../../queries";
import type { PrConversation } from "../../types";
import {
  ConversationSection,
  type ConversationPlan,
  type ConversationSectionProps,
} from "./ConversationSection";

vi.mock("@web/features/review/session", async (importOriginal) => {
  const actual = await importOriginal<typeof SessionModule>();
  return {
    ...actual,
    markSnapshotCommentsSubmitted: vi.fn(),
    persistReplyDraft: vi.fn(),
  };
});

// One ordered hook: cleanup() unmounts the MindMapProvider, whose teardown
// FLUSHES a pending snapshot write — the storage clear must run after it, or
// one test's drafts hydrate into the next (every test shares a briefId).
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

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
  chunks: [chunk("c1", "src/a.ts")],
  concernView: [],
};
const providerModel = buildBriefViewModel(providerBrief);

/** Live handles into the session store the composer reads (drafts, actions). */
interface SessionTap {
  actions: MindMapActions | undefined;
  drafts: Readonly<Record<string, string>> | undefined;
}

function SessionTapProbe({ tap }: { tap: SessionTap }) {
  tap.actions = useMindMapActions();
  tap.drafts = useMindMap((state) => state.replyDrafts);
  return null;
}

function renderSection(
  overrides: Partial<ConversationSectionProps> & {
    plan: ConversationPlan;
    /** Seeded through the live session store (the composer's draft source). */
    replyDrafts?: Record<string, string>;
  },
) {
  const { replyDrafts, ...propOverrides } = overrides;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // The reply composer reads announce from the ReviewFlow store — wrap the
  // real action so copy is observable as a call.
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
  const announce = vi.fn(flowStore.getState().actions.announce);
  flowStore.setState({
    actions: { ...flowStore.getState().actions, announce },
  });
  const tap: SessionTap = { actions: undefined, drafts: undefined };
  const props: ConversationSectionProps = {
    briefId: "db:42:7:base:head",
    chunks: [chunk("c1", "src/a.ts")],
    localComments: [],
    submittedReviewIds: [],
    jumpToChunk: vi.fn(),
    markCommentsSubmitted: vi.fn(),
    // Tests exercise the EXPANDED section; the collapsed header is covered
    // by its own cases.
    open: true,
    onToggle: vi.fn(),
    ...propOverrides,
  };
  const ui = (current: ConversationSectionProps) => (
    <QueryClientProvider client={client}>
      <MindMapProvider briefId={current.briefId} model={providerModel}>
        <ReviewFlowProvider store={flowStore}>
          <SessionTapProbe tap={tap} />
          <ConversationSection {...current} />
        </ReviewFlowProvider>
      </MindMapProvider>
    </QueryClientProvider>
  );
  const view = render(ui(props));
  if (replyDrafts !== undefined) {
    act(() => {
      for (const [threadId, body] of Object.entries(replyDrafts)) {
        tap.actions?.setReplyDraft(Number(threadId), body);
      }
    });
  }
  return { client, props, view, announce, tap };
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
    fireEvent.click(screen.getByRole("button", { name: "Jump to comment" }));
    // The jump carries the thread's diff-row target so the page can land on
    // the comment's row, not the chunk top (post-smoke fix).
    expect(props.jumpToChunk).toHaveBeenCalledWith("c1", {
      rowId: "c1:1",
      threadId: 9001,
    });
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
    const { props, announce, tap } = renderSection({
      plan: plan([ready(), ready()]),
      replyDrafts: { "9001": "a follow-up" },
    });
    await openThread();
    const textarea = screen.getByLabelText(/Reply \(posts to GitHub/);
    expect((textarea as HTMLTextAreaElement).value).toBe("a follow-up");
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await waitFor(() =>
      expect(props.plan.postReply).toHaveBeenCalledWith(9001, "a follow-up"),
    );
    // The store draft clears on the commit point (an empty body drops the key).
    await waitFor(() => expect(tap.drafts?.["9001"]).toBeUndefined());
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
    const { tap } = renderSection({ plan: plan([ready()]) });
    await openThread();
    const textarea = screen.getByLabelText(/Reply \(posts to GitHub/);
    fireEvent.change(textarea, { target: { value: "half a thought" } });
    // Typing stays local — no store churn per keystroke.
    expect(tap.drafts?.["9001"]).toBeUndefined();
    fireEvent.blur(textarea);
    expect(tap.drafts?.["9001"]).toBe("half a thought");
  });

  it("clears the durable draft when success settles after unmount", async () => {
    const { markSnapshotCommentsSubmitted: _flip, persistReplyDraft } =
      await import("@web/features/review/session");
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

  it("an explicit draft reset wins: an untouched composer does not resurrect cleared text", async () => {
    // REVERSED from an earlier round: re-persisting on unmount would also
    // resurrect a posted twin's text and let a stale twin clobber newer
    // edits — an EXPLICIT Clear local drafts beats the leftover display.
    const { persistReplyDraft } = await import("@web/features/review/session");
    const durable = vi.mocked(persistReplyDraft);
    const { view, tap } = renderSection({
      plan: plan([ready()]),
      replyDrafts: { "9001": "still visible" },
    });
    await openThread();
    // The external reset (Clear local drafts) empties the store's drafts.
    act(() => {
      tap.actions?.setReplyDraft(9001, "");
    });
    durable.mockClear();
    view.unmount();
    // The untouched composer writes nothing on unmount — live or durable.
    expect(durable).not.toHaveBeenCalled();
  });

  it("persists an unsynced draft on unmount (navigation survival)", async () => {
    const { persistReplyDraft } = await import("@web/features/review/session");
    const durable = vi.mocked(persistReplyDraft);
    durable.mockClear();
    const { view } = renderSection({ plan: plan([ready()]) });
    await openThread();
    const textarea = screen.getByLabelText(/Reply \(posts to GitHub/);
    fireEvent.change(textarea, { target: { value: "leaving mid-thought" } });
    view.unmount();
    // The live-store twin of this write is unobservable after unmount; the
    // durable write carries the same payload.
    expect(durable).toHaveBeenCalledWith(
      "db:42:7:base:head",
      9001,
      "leaving mid-thought",
    );
  });

  it("keeps the draft and announces on failure (indeterminate copy on throw)", async () => {
    const failingPlan = plan([ready()]);
    (failingPlan.postReply as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("boom"),
    );
    const { announce, tap } = renderSection({
      plan: failingPlan,
      replyDrafts: { "9001": "risky reply" },
    });
    await openThread();
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await waitFor(() =>
      expect(announce).toHaveBeenCalledWith(
        expect.stringContaining("may or may not have posted"),
      ),
    );
    // The draft survives the failure.
    expect(tap.drafts?.["9001"]).toBe("risky reply");
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
    // Instance-scoped ids (useId): association is by reference, not by a
    // thread-derived literal.
    const describedBy = textarea.getAttribute("aria-describedby");
    const alert = screen.getByRole("alert");
    expect(describedBy).toBe(alert.id);
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

describe("Fable round fixes", () => {
  it("the heading is a natively focusable disclosure with the summary visible collapsed", async () => {
    const onToggle = vi.fn();
    renderSection({ plan: plan([ready()]), open: false, onToggle });
    const toggle = await screen.findByRole("button", {
      name: /Conversation.*2 threads.*1.*open/,
    });
    // A button is natively focusable — the C shortcut's focus target.
    expect(toggle.id).toBe("conversation-heading");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Collapsed: the digest is hidden, the summary is not.
    expect(screen.queryByText("changes requested")).toBeNull();
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("an untouched composer twin never clobbers the saved draft on unmount", async () => {
    // The store holds a draft; this composer instance mounts WITH it and the
    // user never edits here (the twin at the chunk did the typing). Its
    // unmount must not write anything — especially not an empty body.
    const { persistReplyDraft } = await import("@web/features/review/session");
    const durable = vi.mocked(persistReplyDraft);
    const { view } = renderSection({
      plan: plan([ready()]),
      replyDrafts: { "9001": "typed at the chunk twin" },
    });
    await openThread();
    durable.mockClear();
    view.unmount();
    expect(durable).not.toHaveBeenCalled();
  });

  it("derives the composer input id per instance, not per thread", async () => {
    renderSection({
      plan: plan([ready()]),
      replyDrafts: { "9001": "draft" },
    });
    await openThread();
    const textarea = screen.getByLabelText(/Reply \(posts to GitHub/);
    // Instance-scoped (useId, now inside MarkdownTextarea) — a thread-derived
    // id would duplicate when the same thread renders inline at its chunk and
    // in the section. Distinctness across instances is pinned in
    // MarkdownTextarea.test.tsx.
    expect(textarea.id).not.toBe("reply-9001");
  });
});

// ---------------------------------------------------------------------------
// Outdated-thread revision jump (BRIEF-24 handoff).
// ---------------------------------------------------------------------------

function outdatedHumanConversation(anchorSha: string): PrConversation {
  return {
    threads: [
      {
        rootCommentId: 7777,
        path: "src/a.ts",
        subjectType: "LINE",
        isResolved: false,
        isOutdated: true,
        anchorSha,
        comments: [
          {
            commentId: 7777,
            author: { login: "alice", isBot: false },
            body: "old comment on an earlier revision",
            createdAt: "2026-07-01T10:00:00Z",
            url: "https://example.test/c/7777",
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
  };
}

function jumpPlan(
  anchorSha: string,
  knownHeads: string[],
  onJump = vi.fn(),
): { plan: ConversationPlan; onJump: ReturnType<typeof vi.fn> } {
  return {
    plan: {
      ...plan([
        { kind: "ready", conversation: outdatedHumanConversation(anchorSha) },
      ]),
      revisionJump: { knownHeads: new Set(knownHeads), onJump },
    },
    onJump,
  };
}

describe("ConversationSection — outdated-thread revision jump (BRIEF-24)", () => {
  it("offers an enabled jump when the anchor was a briefed head", async () => {
    const { plan: jp, onJump } = jumpPlan("anchor-1", ["anchor-1"]);
    renderSection({ plan: jp });
    const row = await screen.findByRole("button", {
      name: /old comment on an earlier revision/i,
    });
    fireEvent.click(row);
    const jump = await screen.findByRole("button", {
      name: /jump to revision/i,
    });
    expect(jump.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(jump);
    expect(onJump).toHaveBeenCalledWith("anchor-1", 7777);
  });

  it("disables the jump (focusably, with a reason) when the anchor was never briefed", async () => {
    const { plan: jp, onJump } = jumpPlan("anchor-x", ["anchor-1"]);
    renderSection({ plan: jp });
    const row = await screen.findByRole("button", {
      name: /old comment on an earlier revision/i,
    });
    fireEvent.click(row);
    const jump = await screen.findByRole("button", {
      name: /jump to revision/i,
    });
    expect(jump.getAttribute("aria-disabled")).toBe("true");
    const reason = document.getElementById(
      jump.getAttribute("aria-describedby") ?? "",
    );
    expect(reason?.textContent).toMatch(/never briefed/i);
    fireEvent.click(jump);
    expect(onJump).not.toHaveBeenCalled();
  });

  it("reveals a target hidden behind the group's show-more cap before landing", async () => {
    // 51 unresolved threads + a resolved target: sorted last (resolved sinks),
    // it falls past the 50-row cap and would never render — the landing
    // effect must lift the cap for its group first (codex round 1).
    const filler = Array.from({ length: 51 }, (_, i) => {
      const id = 20_000 + i;
      return {
        rootCommentId: id,
        path: "src/a.ts",
        line: 10,
        side: "RIGHT" as const,
        subjectType: "LINE" as const,
        isResolved: false,
        isOutdated: false,
        comments: [
          {
            commentId: id,
            author: { login: `human${String(i)}`, isBot: false },
            body: `filler ${String(i)}`,
            createdAt: "2026-07-01T10:00:00Z",
            url: `https://example.test/c/${String(id)}`,
          },
        ],
        hasMoreComments: false,
      };
    });
    const target = {
      rootCommentId: 30_001,
      path: "src/a.ts",
      line: 10,
      side: "RIGHT" as const,
      subjectType: "LINE" as const,
      isResolved: true,
      isOutdated: false,
      comments: [
        {
          commentId: 30_001,
          author: { login: "alice", isBot: false },
          body: "the capped target",
          createdAt: "2026-07-01T10:00:00Z",
          url: "https://example.test/c/30001",
        },
      ],
      hasMoreComments: false,
    };
    const payload: PrConversation = {
      threads: [...filler, target],
      reviews: [],
      prComments: [],
      hasMoreThreads: false,
      hasMoreReviews: false,
      hasMorePrComments: false,
    };
    renderSection({
      plan: plan([{ kind: "ready", conversation: payload }]),
      focusThreadId: 30_001,
    });
    // Without the reveal, this row is sliced out by GROUP_ROW_CAP and the
    // landing effect polls into nothing.
    await waitFor(() =>
      expect(
        document.querySelector('[data-conversation-section-thread="30001"]'),
      ).not.toBeNull(),
    );
  });

  it("lands with an instant scroll when the viewer prefers reduced motion", async () => {
    // The setup stub's matchMedia always reports matches=false; override it
    // for this test to simulate prefers-reduced-motion: reduce.
    const originalMatchMedia = globalThis.matchMedia;
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView");
    globalThis.matchMedia = (query: string) => {
      const list = originalMatchMedia(query);
      return query.includes("prefers-reduced-motion")
        ? new Proxy(list, {
            get: (target, prop) =>
              prop === "matches" ? true : Reflect.get(target, prop),
          })
        : list;
    };
    try {
      const { plan: jp } = jumpPlan("anchor-1", ["anchor-1"]);
      renderSection({ plan: jp, focusThreadId: 7777 });
      await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
      expect(scrollSpy).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: "auto" }),
      );
    } finally {
      globalThis.matchMedia = originalMatchMedia;
      scrollSpy.mockRestore();
    }
  });

  it("lands on the ?thread= target by auto-expanding its row (reads thread=)", async () => {
    const { plan: jp } = jumpPlan("anchor-1", ["anchor-1"]);
    renderSection({ plan: jp, focusThreadId: 7777 });
    // The targeted thread expands on its own — the reply composer (rendered
    // only inside an expanded thread detail) appears with no manual click.
    expect(
      await screen.findByLabelText(/Reply \(posts to GitHub/),
    ).toBeDefined();
    // The row carries the jump-target hook the router-driven landing queries…
    expect(
      document.querySelector('[data-conversation-section-thread="7777"]'),
    ).not.toBeNull();
    // …and NOT the inline diff rows' attribute: the section renders above
    // the change groups, so sharing `data-conversation-thread` would shadow
    // the diff row for BriefScreen's "Jump to comment" landing (codex
    // round 5).
    expect(document.querySelector("[data-conversation-thread]")).toBeNull();
  });
});
