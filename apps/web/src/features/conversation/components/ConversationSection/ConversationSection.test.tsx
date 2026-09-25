// @vitest-environment jsdom
// The in-flow conversation section: verdict strip + digest over canned query
// data. Pins the a11y contract (disclosure buttons carry aria-expanded; chips
// carry text), expansion surviving refetch, the specific error states, the
// empty state, and the reconciliation flip.
import { appI18n } from "../../../../i18n/I18nProvider";
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

import type { Brief, BriefChunk } from "@web/features/brief/types";
import { buildBriefViewModel } from "@web/features/brief/utils";
import {
  CommentSides,
  ReviewCommentStatuses,
  type ReviewComment,
} from "@web/features/review/utils";
import {
  createReviewFlowStore,
  ReviewSessionProvider,
  ReviewFlowProvider,
  useReviewSessionActions,
  type ReviewSessionActions,
} from "@web/features/review/session";
import type { ConversationResult } from "../../queries";
import {
  ThreadSubjectTypes,
  ThreadSides,
  type PrConversation,
} from "../../types";
import { CommentAnchorKinds } from "types/comments";
import {
  DEFAULT_CONVERSATION_FILTER,
  parseConversationFilter,
  type ConversationFilter,
} from "../../utils/filter";
import {
  ConversationSection,
  type ConversationPlan,
  type ConversationSectionProps,
} from ".";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

/** The composer's durable draft, read where it actually lives. */
function getReplyDraft(threadId: number): string | null {
  return sessionStorage.getItem(`mergebrief.replyDraft.${threadId}`);
}

const BRIEF_ID = "db:42:7:base:head";

function chunk(id: string, file: string): BriefChunk {
  return {
    id,
    changeGroupId: "g1",
    file,
    concern: "implementation",
    role: "core",
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
        side: ThreadSides.RIGHT,
        subjectType: ThreadSubjectTypes.LINE,
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
        side: ThreadSides.RIGHT,
        subjectType: ThreadSubjectTypes.LINE,
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

/** Live handle into the session store's actions. */
interface SessionTap {
  actions: ReviewSessionActions | undefined;
}

function SessionTapProbe({ tap }: { tap: SessionTap }) {
  tap.actions = useReviewSessionActions();
  return null;
}

function renderSection(
  overrides: Partial<ConversationSectionProps> & {
    plan: ConversationPlan;
    /** Seeded into sessionStorage, the composer's only draft source. */
    replyDrafts?: Record<string, string>;
  },
) {
  const { replyDrafts, ...propOverrides } = overrides;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // The reply composer reads announce from the ReviewFlow store, wrap the
  // real action so copy is observable as a call.
  const flowStore = createReviewFlowStore(
    {
      saveComment: vi.fn(),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
      toggleComment: vi.fn(),
      reanchorComment: vi.fn(),
    },
    {
      composerDisabledReason: undefined,
      flagsReadOnly: false,
      postingCommentIds: new Set(),
      postBlockedExternally: undefined,
      postComment: undefined,
    },
    appI18n.t,
  );
  const announce = vi.fn(flowStore.getState().actions.announce);
  flowStore.setState({
    actions: { ...flowStore.getState().actions, announce },
  });
  const tap: SessionTap = { actions: undefined };
  const props: ConversationSectionProps = {
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
  const ui = (current: ConversationSectionProps | null) => (
    <QueryClientProvider client={client}>
      <ReviewSessionProvider briefId={BRIEF_ID} model={providerModel}>
        <ReviewFlowProvider store={flowStore}>
          <SessionTapProbe tap={tap} />
          {current === null ? null : <ConversationSection {...current} />}
        </ReviewFlowProvider>
      </ReviewSessionProvider>
    </QueryClientProvider>
  );
  if (replyDrafts !== undefined) {
    for (const [threadId, body] of Object.entries(replyDrafts)) {
      sessionStorage.setItem(`mergebrief.replyDraft.${threadId}`, body);
    }
  }
  const view = render(ui(props));
  // Unmounts ONLY the section: the probe stays mounted, so the composer's
  // unmount write to the store is observable, which it would not be if the
  // whole tree (the store with it) went away.
  const unmountSection = () => {
    act(() => {
      view.rerender(ui(null));
    });
  };
  return { client, props, view, announce, tap, unmountSection };
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

  it("counts comments past the generation cutoff in the header line", async () => {
    // Cutoff between the fixtures' 10:00 and 11:00 comments → exactly one.
    renderSection({
      plan: {
        ...plan([ready()]),
        briefGeneratedAt: "2026-07-01T10:30:00Z",
      },
    });
    expect(
      await screen.findByText("1 new comment since this brief was generated"),
    ).toBeDefined();
  });

  it("omits the count line without a cutoff and marks nothing", async () => {
    renderSection({ plan: plan([ready()]) });
    await screen.findByText("changes requested");
    expect(screen.queryByText(/since this brief was generated/)).toBeNull();
    expect(screen.queryByText("new since this brief")).toBeNull();
  });

  it("chips a postdating comment inside the expanded thread detail", async () => {
    renderSection({
      plan: {
        ...plan([ready()]),
        briefGeneratedAt: "2026-07-01T09:00:00Z",
      },
    });
    // Both fixture comments postdate the cutoff.
    expect(
      await screen.findByText("2 new comments since this brief was generated"),
    ).toBeDefined();
    // Expand alice's (human) thread row, its detail chips the comment.
    fireEvent.click(
      screen.getByRole("button", {
        name: /This null check looks inverted/,
      }),
    );
    expect(await screen.findByText("new since this brief")).toBeDefined();
  });

  it("leaves the reviewer's own submit out of the count and the chip", async () => {
    const withOwn = conversation();
    const ownThread = withOwn.threads[0];
    if (ownThread === undefined) throw new Error("fixture");
    const ownPayload: PrConversation = {
      ...withOwn,
      threads: [
        {
          ...ownThread,
          comments: ownThread.comments.map((comment) => ({
            ...comment,
            reviewId: 500,
          })),
        },
        ...withOwn.threads.slice(1),
      ],
    };
    renderSection({
      plan: {
        ...plan([{ kind: "ready", conversation: ownPayload }]),
        briefGeneratedAt: "2026-07-01T09:00:00Z",
      },
      submittedReviewIds: [500],
    });
    // Only the bot's comment is news; alice's thread is the reviewer's own.
    expect(
      await screen.findByText("1 new comment since this brief was generated"),
    ).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", {
        name: /This null check looks inverted/,
      }),
    );
    await screen.findByText("yours");
    expect(screen.queryByText("new since this brief")).toBeNull();
  });

  it("expands a thread row via aria-expanded and jumps to its chunk", async () => {
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

  it("keeps expansion across a refetch from state, not entry path", async () => {
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
          // outdated, not open.
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

  it("flips drafts the reconciliation proved posted", async () => {
    const localDraft: ReviewComment = {
      id: "ghost-draft",
      anchor: {
        kind: CommentAnchorKinds.LINE,
        chunkId: "c1",
        file: "src/a.ts",
        side: CommentSides.NEW,
        startLine: 10,
        endLine: 10,
        rowIds: ["c1:1"],
        selectedText: "b",
      },
      body: "This null check looks inverted.",
      status: ReviewCommentStatuses.DRAFT,
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

describe("thread resolution wiring", () => {
  it("offers no resolve action when the plan carries no resolution", async () => {
    renderSection({ plan: plan([ready()]) });
    await openThread();
    expect(screen.queryByTestId("thread-resolve")).toBeNull();
  });

  it("resolves through the plan and refetches THIS section's query", async () => {
    const setResolved = vi.fn(async () => ({
      kind: "done" as const,
      resolved: true,
      alreadyInTargetState: false,
    }));
    renderSection({
      plan: {
        ...plan([ready(), ready()]),
        resolution: {
          canResolve: true,
          setResolved,
          refetchCapability: vi.fn(),
        },
      },
    });
    await openThread();
    fireEvent.click(screen.getByTestId("thread-resolve"));
    await waitFor(() => expect(setResolved).toHaveBeenCalledWith(9001, true));
    // The slim-row transition is refetched truth: the shared query must run
    // again (the route evicted the server cache on the write).
    await waitFor(() =>
      expect((planQueryCalls.count as () => number)()).toBeGreaterThanOrEqual(
        2,
      ),
    );
  });

  it("hides the action when the viewer cannot resolve", async () => {
    renderSection({
      plan: {
        ...plan([ready()]),
        resolution: {
          canResolve: false,
          setResolved: vi.fn(),
          refetchCapability: vi.fn(),
        },
      },
    });
    await openThread();
    expect(screen.queryByTestId("thread-resolve")).toBeNull();
  });
});

describe("quote reply", () => {
  it("Quote reply prefills the reply box with the quoted comment", async () => {
    renderSection({ plan: plan([ready()]) });
    await openThread();
    const quoteButton = screen
      .getAllByRole("button", { name: /Quote reply to @/ })
      .at(0);
    if (quoteButton === undefined) throw new Error("Quote reply not rendered");
    fireEvent.click(quoteButton);
    const textarea = screen.getByLabelText(/Reply \(posts to GitHub/);
    expect((textarea as HTMLTextAreaElement).value).toBe(
      "> This null check looks inverted.\n\n",
    );
    // Quoting again appends again (nonce-triggered, not text-triggered).
    fireEvent.click(quoteButton);
    expect((textarea as HTMLTextAreaElement).value).toBe(
      "> This null check looks inverted.\n\n> This null check looks inverted.\n\n",
    );
  });

  it("R with a selection inside the thread quotes it; no selection, no-op", async () => {
    renderSection({ plan: plan([ready()]) });
    await openThread();
    const textarea = screen.getByLabelText(/Reply \(posts to GitHub/);
    // No selection: R must do nothing.
    fireEvent.keyDown(window, { key: "r" });
    expect((textarea as HTMLTextAreaElement).value).toBe("");
    // Select the comment text inside the detail (the markdown-rendered <p>,
    // not the row-summary span), then press R.
    const commentText = screen
      .getAllByText("This null check looks inverted.")
      .find((element) => element.tagName === "P");
    if (commentText === undefined) throw new Error("comment body not found");
    const range = document.createRange();
    range.selectNodeContents(commentText);
    const selection = window.getSelection();
    if (selection === null) throw new Error("jsdom selection unavailable");
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.keyDown(window, { key: "r" });
    expect((textarea as HTMLTextAreaElement).value).toBe(
      "> This null check looks inverted.\n\n",
    );
  });
});

describe("ReplyComposer", () => {
  it("posts a reply, clears the draft, announces, and refetches", async () => {
    const { props, announce } = renderSection({
      plan: plan([ready(), ready()]),
      replyDrafts: { "9001": "a follow-up" },
    });
    await openThread();
    const textarea = screen.getByLabelText(/Reply \(posts to GitHub/);
    expect((textarea as HTMLTextAreaElement).value).toBe("a follow-up");
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    // The body rides the request: one external write, no draft behind it.
    await waitFor(() =>
      expect(props.plan.postReply).toHaveBeenCalledWith(9001, "a follow-up"),
    );
    // The durable draft clears on the commit point.
    await waitFor(() => expect(getReplyDraft(9001)).toBeNull());
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

  it("persists the draft as it is typed so navigation survives it", async () => {
    renderSection({ plan: plan([ready()]) });
    await openThread();
    const textarea = screen.getByLabelText(/Reply \(posts to GitHub/);
    fireEvent.change(textarea, { target: { value: "half a thought" } });
    expect(getReplyDraft(9001)).toBe("half a thought");
  });

  it("keeps the draft and announces indeterminate copy on failure", async () => {
    const failingPlan = plan([ready()]);
    (failingPlan.postReply as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("boom"),
    );
    const { announce } = renderSection({
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
    expect(getReplyDraft(9001)).toBe("risky reply");
    expect(screen.getByRole("alert").textContent).toContain(
      "may or may not have posted",
    );
  });

  it("blocks an over-cap reply with associated error copy", async () => {
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

  it("keeps focus on the Reply button through posting", async () => {
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

  it("blocks an empty reply with a disabled button", async () => {
    renderSection({ plan: plan([ready()]) });
    await openThread();
    const button = screen.getByRole("button", { name: "Reply" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("disclosure and focus behaviour", () => {
  it("the heading is a focusable disclosure, summary visible collapsed", async () => {
    const onToggle = vi.fn();
    renderSection({ plan: plan([ready()]), open: false, onToggle });
    const toggle = await screen.findByRole("button", {
      name: /Conversation.*2 threads.*1.*open/,
    });
    // A button is natively focusable, the C shortcut's focus target.
    expect(toggle.id).toBe("conversation-heading");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const twist = toggle.querySelector('[data-icon="caret-down"]');
    expect(twist?.getAttribute("data-rotation")).toBe("270");
    // Collapsed: the digest is hidden, the summary is not.
    expect(screen.queryByText("changes requested")).toBeNull();
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("an untouched composer twin never clobbers the saved draft on unmount", async () => {
    // sessionStorage holds a draft; this composer instance mounts WITH it and
    // the user never edits here (the twin at the chunk did the typing). Its
    // unmount must not write anything, especially not an empty body.
    const { unmountSection } = renderSection({
      plan: plan([ready()]),
      replyDrafts: { "9001": "typed at the chunk twin" },
    });
    await openThread();
    unmountSection();
    expect(getReplyDraft(9001)).toBe("typed at the chunk twin");
  });

  it("derives the composer input id per instance, not per thread", async () => {
    renderSection({
      plan: plan([ready()]),
      replyDrafts: { "9001": "draft" },
    });
    await openThread();
    const textarea = screen.getByLabelText(/Reply \(posts to GitHub/);
    // Instance-scoped (useId, now inside MarkdownTextarea), a thread-derived
    // id would duplicate when the same thread renders inline at its chunk and
    // in the section. Distinctness across instances is pinned in
    // MarkdownTextarea.test.tsx.
    expect(textarea.id).not.toBe("reply-9001");
  });
});

// ---------------------------------------------------------------------------
// Outdated-thread revision jump.
// ---------------------------------------------------------------------------

function outdatedHumanConversation(anchorSha: string): PrConversation {
  return {
    threads: [
      {
        rootCommentId: 7777,
        path: "src/a.ts",
        subjectType: ThreadSubjectTypes.LINE,
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

describe("ConversationSection outdated-thread revision jump", () => {
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

  it("disables the jump focusably when the anchor was never briefed", async () => {
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

  it("reveals a target behind the show-more cap before landing", async () => {
    // 51 unresolved threads + a resolved target: sorted last (resolved sinks),
    // it falls past the 50-row cap and would never render, the landing
    // effect must lift the cap for its group first.
    const filler = Array.from({ length: 51 }, (_, i) => {
      const id = 20_000 + i;
      return {
        rootCommentId: id,
        path: "src/a.ts",
        line: 10,
        side: ThreadSides.RIGHT,
        subjectType: ThreadSubjectTypes.LINE,
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
      side: ThreadSides.RIGHT,
      subjectType: ThreadSubjectTypes.LINE,
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

  it("lands on the ?thread= target by auto-expanding its row", async () => {
    const { plan: jp } = jumpPlan("anchor-1", ["anchor-1"]);
    renderSection({ plan: jp, focusThreadId: 7777 });
    // The targeted thread expands on its own, the reply composer (rendered
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
    // the diff row for BriefScreen's "Jump to comment" landing.
    expect(document.querySelector("[data-conversation-thread]")).toBeNull();
  });

  describe("filter bar", () => {
    /** A conversation with two humans and one bot, each holding a thread. */
    function filterConversation(): PrConversation {
      const base = conversation();
      return {
        ...base,
        reviews: [
          ...base.reviews,
          {
            reviewId: 501,
            author: { login: "bob", isBot: false },
            state: "APPROVED",
            body: "ship it",
            submittedAt: "2026-07-01T12:00:00Z",
            url: "https://example.test/r/501",
          },
          {
            reviewId: 502,
            author: { login: "alice", isBot: false },
            state: "COMMENTED",
            body: "",
            submittedAt: "2026-07-01T13:00:00Z",
            url: "https://example.test/r/502",
          },
        ],
      };
    }

    /** The filter rides as SECTION props, never on the plan, whose identity
     * feeds the memo boundaries that keep the diff off the render path. */
    function filterProps(filter: ConversationFilter) {
      const onFilterChange = vi.fn<(next: ConversationFilter) => void>();
      return {
        plan: plan([{ kind: "ready", conversation: filterConversation() }]),
        filter,
        onFilterChange,
      };
    }

    it("filters the digest, the strip and the PR comments by reviewer", async () => {
      renderSection(filterProps(parseConversationFilter({ reviewers: "bob" })));
      // Bob has no threads, so alice's thread and her verdict both go.
      expect(await screen.findByText("ship it")).toBeDefined();
      expect(screen.queryByText("needs work")).toBeNull();
      expect(screen.queryByText(/This null check looks inverted/)).toBeNull();
    });

    it("teaches a filtered empty state, distinct from the no-conversation one", async () => {
      renderSection(
        filterProps(parseConversationFilter({ reviewers: "nobody-here" })),
      );
      // An unmatched login reconciles away, so the section stays populated,
      // the empty state belongs to a filter that matched a real reviewer.
      expect(await screen.findByText("needs work")).toBeDefined();
      cleanup();
      renderSection(
        filterProps(
          parseConversationFilter({
            reviewers: "bob",
            verdicts: "changes-requested",
          }),
        ),
      );
      expect(
        await screen.findByText("No activity matches these filters."),
      ).toBeDefined();
    });

    it("keeps a standing approval a later empty envelope would hide", async () => {
      // Alice's newest review is GitHub's inline-comment envelope, which
      // renders nothing, her change-request is what still stands.
      renderSection(filterProps(DEFAULT_CONVERSATION_FILTER));
      expect(await screen.findByText("needs work")).toBeDefined();
      expect(screen.getByText("ship it")).toBeDefined();
    });

    it("keeps unfiltered totals in the header, filter state stays out", async () => {
      // The toolbar trigger is the ONE place filter state renders; the
      // header keeps describing the whole conversation, so a hard filter
      // cannot dress totals up as data loss.
      renderSection(filterProps(parseConversationFilter({ reviewers: "bob" })));
      await waitFor(() =>
        expect(screen.getByText(/2 threads · 1 open$/)).toBeDefined(),
      );
      expect(screen.queryByText(/filtered/)).toBeNull();
    });
  });
});
