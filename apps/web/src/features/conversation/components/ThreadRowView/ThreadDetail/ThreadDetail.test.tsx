// @vitest-environment jsdom
// Resolution uses refetches rather than optimistic state; a landed reply must never repost.
import { appI18n } from "../../../../../i18n/I18nProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
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
  createReviewFlowStore,
  ReviewSessionProvider,
  ReviewFlowProvider,
} from "@web/features/review/session";
import type { DigestThreadRow } from "../../../utils/digest";
import type { ReplyResult } from "../../../reply";
import type { ResolveThreadResult } from "../../../resolve";
import type { ConversationThread } from "../../../types";
import type { Mutable } from "types/utils";
import type {
  ThreadComposerWiring,
  ThreadResolutionWiring,
} from "../../../wiring";
import { ThreadDetail } from ".";

const BRIEF_ID = "db:42:7:base:head";
const THREAD_ID = 9001;

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
    role: "core",
    loc: { added: 1, deleted: 0 },
    addedRanges: [],
    removedRanges: [],
    riskSurface: [],
    diff: [{ kind: "add", content: "b", newLine: 10 }],
  } as BriefChunk;
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

function threadRow(isResolved = false): DigestThreadRow {
  const thread: ConversationThread = {
    rootCommentId: THREAD_ID,
    path: "src/a.ts",
    line: 10,
    side: "RIGHT",
    subjectType: "LINE",
    isResolved,
    isOutdated: false,
    comments: [
      {
        commentId: THREAD_ID,
        author: { login: "alice", isBot: false },
        body: "This null check looks inverted.",
        createdAt: "2026-07-01T10:00:00Z",
        url: "https://example.test/c/9001",
      },
    ],
    hasMoreComments: false,
  };
  return {
    kind: "thread",
    thread,
    digestLine: "This null check looks inverted.",
    placement: { kind: "chunk", chunkId: "c1", rowId: "c1:1" },
    isOwn: false,
  };
}

interface Harness {
  announce: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  setResolved: ReturnType<typeof vi.fn>;
  refetchConversation: ReturnType<typeof vi.fn>;
  refetchCapability: ReturnType<typeof vi.fn>;
  /** Call order across BOTH transports, the combo's sequencing evidence. */
  calls: string[];
}

interface RenderOptions {
  isResolved?: boolean;
  /** Absent = no resolution wiring at all (the local demo path). */
  canResolve?: boolean | undefined;
  /** Repo-collaborator mention pool riding the composer wiring. */
  mentionPool?: ThreadComposerWiring["mentionPool"];
  reply?: ReplyResult | (() => Promise<ReplyResult>);
  resolve?: ResolveThreadResult | (() => Promise<ResolveThreadResult>);
}

function renderDetail(options: RenderOptions = {}) {
  const calls: string[] = [];
  const replyOutcome = options.reply ?? {
    kind: "posted" as const,
    commentId: 5,
  };
  const resolveOutcome = options.resolve ?? {
    kind: "done" as const,
    resolved: true,
    alreadyInTargetState: false,
  };
  const post = vi.fn(async () => {
    calls.push("reply");
    return typeof replyOutcome === "function"
      ? await replyOutcome()
      : replyOutcome;
  });
  const setResolved = vi.fn(async () => {
    calls.push("resolve");
    return typeof resolveOutcome === "function"
      ? await resolveOutcome()
      : resolveOutcome;
  });
  const refetchConversation = vi.fn();
  const refetchCapability = vi.fn();
  const resolution: ThreadResolutionWiring | undefined =
    options.canResolve === undefined
      ? undefined
      : {
          canResolve: options.canResolve,
          setResolved,
          refetchConversation,
          refetchCapability,
        };
  const composer: Mutable<ThreadComposerWiring> = { post, onPosted: vi.fn() };

  if (options.mentionPool !== undefined) {
    composer.mentionPool = options.mentionPool;
  }
  if (resolution !== undefined) {
    composer.resolution = resolution;
  }
  const flowStore = createReviewFlowStore(
    {
      saveComment: vi.fn(),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
      toggleComment: vi.fn(),
      reanchorComment: vi.fn(),
    },
    appI18n.t,
  );
  const announce = vi.fn(flowStore.getState().actions.announce);
  flowStore.setState({
    actions: { ...flowStore.getState().actions, announce },
  });
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSessionProvider
        briefId={BRIEF_ID}
        model={buildBriefViewModel(providerBrief)}
      >
        <ReviewFlowProvider store={flowStore}>
          <ThreadDetail
            composer={composer}
            jumpToChunk={vi.fn()}
            row={threadRow(options.isResolved ?? false)}
          />
        </ReviewFlowProvider>
      </ReviewSessionProvider>
    </QueryClientProvider>,
  );
  const harness: Harness = {
    announce,
    post,
    setResolved,
    refetchConversation,
    refetchCapability,
    calls,
  };
  return { ...harness, view };
}

function type(text: string) {
  fireEvent.change(screen.getByLabelText(/Reply \(posts to GitHub/), {
    target: { value: text },
  });
}

const RESOLVE_BUTTON = { name: /^Resolv/ };
const UNRESOLVE_BUTTON = { name: /^Unresolv/ };
const COMBO_BUTTON = { name: /^Reply & resolve/ };

describe("ThreadDetail, standalone resolve/unresolve", () => {
  it("shows no resolution action without local wiring", () => {
    renderDetail();
    expect(screen.queryByRole("button", RESOLVE_BUTTON)).toBeNull();
    expect(screen.queryByRole("button", UNRESOLVE_BUTTON)).toBeNull();
  });

  it("hides resolution actions when the viewer lacks capability", () => {
    renderDetail({ canResolve: false });
    expect(screen.queryByRole("button", RESOLVE_BUTTON)).toBeNull();
    expect(screen.queryByRole("button", UNRESOLVE_BUTTON)).toBeNull();
  });

  it("offers Resolve on an unresolved thread and Unresolve on a resolved one", () => {
    const first = renderDetail({ canResolve: true });
    expect(screen.getByRole("button", RESOLVE_BUTTON)).toBeDefined();
    expect(screen.queryByRole("button", UNRESOLVE_BUTTON)).toBeNull();
    first.view.unmount();
    renderDetail({ canResolve: true, isResolved: true });
    expect(screen.getByRole("button", UNRESOLVE_BUTTON)).toBeDefined();
    expect(screen.queryByRole("button", RESOLVE_BUTTON)).toBeNull();
  });

  it("resolves, refetches the conversation, and announces", async () => {
    const h = renderDetail({ canResolve: true });
    fireEvent.click(screen.getByRole("button", RESOLVE_BUTTON));
    await waitFor(() => expect(h.setResolved).toHaveBeenCalledWith(9001, true));
    // Refetched truth, never an optimistic flip: the row transitions when the
    // conversation query lands.
    await waitFor(() => expect(h.refetchConversation).toHaveBeenCalled());
    expect(h.announce).toHaveBeenCalledWith("Thread resolved on GitHub.");
    expect(h.refetchCapability).not.toHaveBeenCalled();
  });

  it("unresolves in the other direction", async () => {
    const h = renderDetail({
      canResolve: true,
      isResolved: true,
      resolve: { kind: "done", resolved: false, alreadyInTargetState: false },
    });
    fireEvent.click(screen.getByRole("button", UNRESOLVE_BUTTON));
    await waitFor(() =>
      expect(h.setResolved).toHaveBeenCalledWith(9001, false),
    );
    expect(h.announce).toHaveBeenCalledWith(
      "Thread marked unresolved on GitHub.",
    );
  });

  it("uses success copy and refetches for a converged flip", async () => {
    const h = renderDetail({
      canResolve: true,
      resolve: { kind: "done", resolved: true, alreadyInTargetState: true },
    });
    fireEvent.click(screen.getByRole("button", RESOLVE_BUTTON));
    await waitFor(() => expect(h.refetchConversation).toHaveBeenCalled());
    expect(h.announce).toHaveBeenCalledWith("Thread resolved on GitHub.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("goes busy while in flight and ignores a second click", async () => {
    let release: ((result: ResolveThreadResult) => void) | undefined;
    const h = renderDetail({
      canResolve: true,
      resolve: () =>
        new Promise<ResolveThreadResult>((resolve) => {
          release = resolve;
        }),
    });
    const button = screen.getByRole("button", RESOLVE_BUTTON);
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByRole("button", RESOLVE_BUTTON).textContent).toBe(
        "Resolving…",
      ),
    );
    const busy = screen.getByRole("button", RESOLVE_BUTTON);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    // aria-disabled does not block clicks, the in-flight guard must.
    fireEvent.click(busy);
    expect(h.setResolved).toHaveBeenCalledTimes(1);
    release?.({ kind: "done", resolved: true, alreadyInTargetState: false });
    await waitFor(() =>
      expect(screen.getByRole("button", RESOLVE_BUTTON).textContent).toBe(
        "Resolve",
      ),
    );
  });

  it("answers a 403 with permission copy and refetches BOTH truths", async () => {
    const h = renderDetail({
      canResolve: true,
      resolve: { kind: "github-permission" },
    });
    fireEvent.click(screen.getByRole("button", RESOLVE_BUTTON));
    const copy =
      "GitHub refused the change — your permission to resolve threads here may have changed.";
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(copy),
    );
    expect(h.announce).toHaveBeenCalledWith(copy);
    // The capability itself may have changed: the buttons must follow the
    // refreshed truth, not the stale PR-meta boolean.
    expect(h.refetchCapability).toHaveBeenCalled();
    expect(h.refetchConversation).toHaveBeenCalled();
  });

  it("keeps per-kind failure copy on the thread and announces it", async () => {
    const h = renderDetail({
      canResolve: true,
      resolve: { kind: "not-found" },
    });
    fireEvent.click(screen.getByRole("button", RESOLVE_BUTTON));
    const copy =
      "This thread is no longer on GitHub — it may have been deleted.";
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(copy),
    );
    expect(h.announce).toHaveBeenCalledWith(copy);
    expect(h.refetchCapability).not.toHaveBeenCalled();
  });

  it("uses indeterminate copy and refreshes after a thrown resolution", async () => {
    const h = renderDetail({
      canResolve: true,
      resolve: () => Promise.reject(new Error("boom")),
    });
    fireEvent.click(screen.getByRole("button", RESOLVE_BUTTON));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "may or may not have changed",
      ),
    );
    expect(h.refetchConversation).toHaveBeenCalled();
  });
});

describe("ThreadDetail, Reply & resolve combo", () => {
  it("appears only once the composer has text", () => {
    renderDetail({ canResolve: true });
    expect(screen.queryByRole("button", COMBO_BUTTON)).toBeNull();
    type("looks fixed");
    expect(screen.getByRole("button", COMBO_BUTTON)).toBeDefined();
    // The primary action stays a plain reply.
    expect(screen.getByRole("button", { name: "Reply" })).toBeDefined();
    type("   ");
    expect(screen.queryByRole("button", COMBO_BUTTON)).toBeNull();
  });

  it("never offers the combo without the capability", () => {
    renderDetail({ canResolve: false });
    type("looks fixed");
    expect(screen.queryByRole("button", COMBO_BUTTON)).toBeNull();
  });

  it("never offers the combo on an already-resolved thread", () => {
    renderDetail({ canResolve: true, isResolved: true });
    type("one more thing");
    expect(screen.queryByRole("button", COMBO_BUTTON)).toBeNull();
  });

  it("posts the reply FIRST, then resolves, and announces both landed", async () => {
    const h = renderDetail({ canResolve: true });
    type("fixed in the last push");
    fireEvent.click(screen.getByRole("button", COMBO_BUTTON));
    await waitFor(() => expect(h.setResolved).toHaveBeenCalled());
    // The reply is the commit point, it must precede the resolve, always.
    expect(h.calls).toEqual(["reply", "resolve"]);
    expect(h.post).toHaveBeenCalledWith(9001, expect.any(String));
    expect(h.setResolved).toHaveBeenCalledWith(9001, true);
    await waitFor(() =>
      expect(h.announce).toHaveBeenCalledWith(
        "Reply posted and the thread resolved.",
      ),
    );
  });

  it("names the running combo on its own button", async () => {
    let release: ((result: ReplyResult) => void) | undefined;
    renderDetail({
      canResolve: true,
      reply: () =>
        new Promise<ReplyResult>((resolve) => {
          release = resolve;
        }),
    });
    type("fixed");
    fireEvent.click(screen.getByRole("button", COMBO_BUTTON));
    await waitFor(() =>
      expect(screen.getByTestId("reply-and-resolve").textContent).toBe(
        "Posting & resolving…",
      ),
    );
    expect(
      screen.getByTestId("reply-and-resolve").getAttribute("aria-busy"),
    ).toBe("true");
    // The plain Reply button did not claim the pending label.
    expect(screen.getByRole("button", { name: "Reply" }).textContent).toBe(
      "Reply",
    );
    release?.({ kind: "posted", commentId: 5 });
  });

  it("keeps the busy combo button mounted after the reply clears the draft", async () => {
    // The reply lands (clearing the draft) while the resolve leg is still in
    // flight: the control the reviewer clicked, and may still be focused on,
    // must not vanish, taking its aria-busy with it.
    let release: ((result: ResolveThreadResult) => void) | undefined;
    renderDetail({
      canResolve: true,
      resolve: () =>
        new Promise<ResolveThreadResult>((resolve) => {
          release = resolve;
        }),
    });
    type("fixed");
    fireEvent.click(screen.getByRole("button", COMBO_BUTTON));
    await waitFor(() =>
      expect(
        (
          screen.getByLabelText(
            /Reply \(posts to GitHub/,
          ) as HTMLTextAreaElement
        ).value,
      ).toBe(""),
    );
    const button = screen.getByTestId("reply-and-resolve");
    expect(button.textContent).toBe("Posting & resolving…");
    expect(button.getAttribute("aria-busy")).toBe("true");
    release?.({ kind: "done", resolved: true, alreadyInTargetState: false });
    // Once settled with an empty draft the affordance retires as designed.
    await waitFor(() =>
      expect(screen.queryByTestId("reply-and-resolve")).toBeNull(),
    );
  });

  it("focuses Resolve when the combo retires after partial success", async () => {
    // The keyboard path: the reply lands (draft cleared), the resolve fails,
    // and the focused combo button retires. Without a handoff activeElement
    // becomes <body> and Tab restarts from the top of the page, here focus
    // must land on the control that finishes the job.
    renderDetail({ canResolve: true, resolve: { kind: "upstream" } });
    type("fixed");
    const combo = screen.getByRole("button", COMBO_BUTTON);
    combo.focus();
    expect(document.activeElement).toBe(combo);
    fireEvent.click(combo);
    // The handoff runs in an effect AFTER the retirement commit, so asserting
    // activeElement on the unmount tick races that flush: await the focus
    // itself, not the unmount.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("thread-resolve")),
    );
  });

  it("hands focus over on the both-landed outcome too", async () => {
    // Same retirement, different outcome: the resolve succeeded, so the
    // standalone control is where the thread's next action lives (Unresolve
    // once the refetch lands). Focus must not fall to <body> either way.
    renderDetail({ canResolve: true });
    type("fixed");
    const combo = screen.getByRole("button", COMBO_BUTTON);
    combo.focus();
    fireEvent.click(combo);
    // Same effect-flush race as above: await the focus, not the unmount.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("thread-resolve")),
    );
  });

  it("leaves focus alone when the reviewer moved it during the request", async () => {
    // Only STRANDED focus is rescued: a reviewer who tabbed elsewhere mid-flight
    // must not be yanked back to the thread's actions.
    renderDetail({ canResolve: true, resolve: { kind: "upstream" } });
    type("fixed");
    const combo = screen.getByRole("button", COMBO_BUTTON);
    combo.focus();
    fireEvent.click(combo);
    const elsewhere = screen.getByRole("button", { name: "Reply" });
    elsewhere.focus();
    await waitFor(() =>
      expect(screen.queryByTestId("reply-and-resolve")).toBeNull(),
    );
    expect(document.activeElement).toBe(elsewhere);
  });

  it("a failed reply resolves nothing and says so", async () => {
    const h = renderDetail({ canResolve: true, reply: { kind: "upstream" } });
    type("fixed");
    fireEvent.click(screen.getByRole("button", COMBO_BUTTON));
    await waitFor(() =>
      expect(
        screen.getAllByRole("alert").map((element) => element.textContent),
      ).toContain(
        "GitHub rejected the reply or is unreachable — try again shortly. The thread was left unresolved.",
      ),
    );
    // Nothing was resolved: the resolve leg never ran.
    expect(h.setResolved).not.toHaveBeenCalled();
    expect(h.calls).toEqual(["reply"]);
  });

  it("states the partial outcome and NEVER retries the landed reply", async () => {
    const h = renderDetail({
      canResolve: true,
      resolve: { kind: "upstream" },
    });
    type("fixed");
    fireEvent.click(screen.getByRole("button", COMBO_BUTTON));
    const partial =
      "Your reply posted, but resolving the thread failed. The reply is on GitHub — use Resolve on the thread to finish.";
    await waitFor(() =>
      expect(
        screen.getAllByRole("alert").map((element) => element.textContent),
      ).toContain(partial),
    );
    expect(h.announce).toHaveBeenCalledWith(partial);
    // The reply is GitHub's record now: one post, ever, a retry would
    // double-post. The standalone Resolve button is the retry path.
    expect(h.post).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", RESOLVE_BUTTON)).toBeDefined();
    // The draft cleared on the reply's success (the commit point), so the
    // combo affordance is gone and the reply cannot be re-sent by mistake.
    expect(screen.queryByRole("button", COMBO_BUTTON)).toBeNull();
  });

  it("uses indeterminate partial copy for a thrown resolve leg", async () => {
    // A dropped connection after the server received the mutation leaves the
    // thread possibly resolved, asserting "resolving failed" would be a lie
    // that invites a blind re-resolve.
    const h = renderDetail({
      canResolve: true,
      resolve: () => Promise.reject(new Error("socket hang up")),
    });
    type("fixed");
    fireEvent.click(screen.getByRole("button", COMBO_BUTTON));
    const indeterminate =
      "Your reply posted; the thread may or may not have been resolved. The conversation was refreshed — check the thread before resolving it again.";
    await waitFor(() =>
      expect(
        screen.getAllByRole("alert").map((element) => element.textContent),
      ).toContain(indeterminate),
    );
    expect(h.announce).toHaveBeenCalledWith(indeterminate);
    // The determinate copy must NOT appear for a throw.
    expect(h.announce).not.toHaveBeenCalledWith(
      expect.stringContaining("resolving the thread failed"),
    );
    // Indeterminate still refetches, that is how the reviewer sees the truth.
    expect(h.refetchConversation).toHaveBeenCalled();
    expect(h.post).toHaveBeenCalledTimes(1);
  });

  it("the submit shortcut takes the plain reply path, never the compound one", async () => {
    // Cmd/Ctrl+Enter is the PRIMARY action only: a compound outward write is
    // never implicit, even with the combo affordance on screen.
    const h = renderDetail({ canResolve: true });
    type("fixed");
    expect(screen.getByRole("button", COMBO_BUTTON)).toBeDefined();
    fireEvent.keyDown(screen.getByLabelText(/Reply \(posts to GitHub/), {
      key: "Enter",
      metaKey: true,
    });
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    expect(h.setResolved).not.toHaveBeenCalled();
    expect(h.calls).toEqual(["reply"]);
    await waitFor(() =>
      expect(h.announce).toHaveBeenCalledWith(
        "Reply posted to GitHub under your account.",
      ),
    );
  });

  it("an indeterminate reply throw never reaches the resolve leg", async () => {
    const h = renderDetail({
      canResolve: true,
      reply: () => Promise.reject(new Error("boom")),
    });
    type("fixed");
    fireEvent.click(screen.getByRole("button", COMBO_BUTTON));
    await waitFor(() =>
      expect(
        screen.getAllByRole("alert").map((element) => element.textContent),
      ).toContain(
        "Something went wrong posting the reply — it may or may not have posted. Check the thread on GitHub before retrying. The thread was left unresolved.",
      ),
    );
    expect(h.setResolved).not.toHaveBeenCalled();
  });
});

describe("ThreadDetail, mention pool hand-off", () => {
  it("ranks thread participants before the composer roster", () => {
    renderDetail({
      mentionPool: [
        {
          login: "alice",
          name: "Alice Example",
          avatarUrl: "https://avatars.example/alice.png",
        },
        { login: "bob", name: "Bob Builder" },
      ],
    });
    type("@");
    const options = screen.getAllByRole("option");
    // Participant alice first, ENRICHED from the roster entry; then the
    // non-participant collaborator. A dropped hand-off would render alice
    // login-only and no bob at all.
    expect(options.map((option) => option.textContent)).toEqual([
      "@aliceAlice Example",
      "@bobBob Builder",
    ]);
    expect(options[0]?.querySelector("img")?.getAttribute("src")).toBe(
      "https://avatars.example/alice.png",
    );
  });

  it("falls back to participants-only without a pool", () => {
    renderDetail({});
    type("@");
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["@alice"]);
  });
});
