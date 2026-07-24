// @vitest-environment jsdom
// The own-draft Brief view (BRIEF-43, ADR 0031): one Brief view for every
// viewer; the author surface is state-derived affordances inside it. This
// suite pins the state's contract through the rendered screen:
//   - the state is visibly labeled (self-review chip) and non-dismissible;
//   - submit-review machinery + receipt are HIDDEN, not broken — nothing
//     dangling that references submit;
//   - risk flags are a read-only mirror (no disposition controls);
//   - chunk tracking and comment drafting stay available (role-free);
//   - when the PrView flips draft=false under a live session (mark-ready or
//     ready-elsewhere), the affordances vanish and the reviewer view appears.
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

import type { MarkReadyResult } from "../../pulls/markReady";
import type { PostCommentResult } from "../../pulls/postComment";
import { MARK_READY_COPY } from "../../pulls/useMarkReady";
import type { ReviewComment } from "../../review/comments";
import { writeSnapshot } from "../../review/session";
import type { OwnDraftPlan } from "./BriefPage/BriefPage";
import {
  BriefView,
  markReadyBatchFailureCopy,
  POST_COMMENT_COPY,
} from "./BriefPage/BriefPage";
import type { Brief } from "../types";
import { briefFixture } from "../fixtures";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

const CHIP_COPY = "Self-review — your draft";

/** The Modal wrapper's open/closed state for the overlay containing `text`. */
function overlayState(text: string): string | undefined | null {
  return screen
    .getByText(text)
    .closest("[data-state]")
    ?.getAttribute("data-state");
}

/** The terminal-slot CTA across its idle/pending labels (never the modal's). */
function markReadyCta(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: /^mark ready for review$|^marking ready/i,
  }) as HTMLButtonElement;
}

/** A review comment anchored on `chunkId` — session-store seeding shape. */
function comment(
  id: string,
  chunkId: string,
  status: ReviewComment["status"],
): ReviewComment {
  return {
    id,
    anchor: {
      chunkId,
      file: "src/x.ts",
      side: "new",
      startLine: 1,
      endLine: 1,
      rowIds: [],
      selectedText: "",
    },
    body: `${id} body`,
    status,
    collapsed: false,
  };
}

/** The same Brief with an empty risk surface — the zero-flag bypass case. */
const flaglessBrief: Brief = {
  ...briefFixture,
  chunks: briefFixture.chunks.map((chunk) => ({ ...chunk, riskSurface: [] })),
};

function renderBriefView(
  ownDraft: OwnDraftPlan | undefined,
  brief: Brief = briefFixture,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = (plan: OwnDraftPlan | undefined) => (
    <QueryClientProvider client={queryClient}>
      <BriefView
        artifacts={[]}
        brief={brief}
        briefId="own-draft-test"
        searchParams={{}}
        ownDraft={plan}
      />
    </QueryClientProvider>
  );
  const utils = render(view(ownDraft));
  return {
    rerenderWith: (plan: OwnDraftPlan | undefined) =>
      utils.rerender(view(plan)),
  };
}

describe("own-draft Brief view (BRIEF-43)", () => {
  it("labels the state with the chip and swaps the terminal-action slot", () => {
    renderBriefView({ markReady: vi.fn() });
    expect(screen.getByText(CHIP_COPY)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Mark ready for review" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Receipt" })).toBeNull();
  });

  it("renders no own-draft affordances on a plain reviewer view", () => {
    renderBriefView(undefined);
    expect(screen.queryByText(CHIP_COPY)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Mark ready for review" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Receipt" })).toBeTruthy();
  });

  it("hides the submit machinery and the receipt entirely — nothing dangling", () => {
    renderBriefView({ markReady: vi.fn() });
    // The receipt drawer and its Submit button are not in the DOM at all.
    expect(screen.queryByRole("button", { name: /submit review/i })).toBeNull();
    expect(screen.queryByText(/review receipt/i)).toBeNull();
    // The pre-submit ("Before the receipt") modal is unmounted too.
    expect(screen.queryByText(/before the receipt/i)).toBeNull();
    // No menu path back into submit: Summary preview is gone.
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(
      screen.queryByRole("menuitem", { name: /summary preview/i }),
    ).toBeNull();
  });

  it("renders risk flags as a read-only mirror — visible, no disposition controls", () => {
    renderBriefView({ markReady: vi.fn() });
    // The flags stay fully visible (the mirror)…
    expect(screen.getAllByText("no-tests").length).toBeGreaterThan(0);
    // …but every disposition control is gone.
    expect(screen.queryByRole("button", { name: "Addressed" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^dismiss/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /address selected/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("checkbox", { name: /select .* flag/i }),
    ).toBeNull();
  });

  it("keeps chunk tracking available (local session state is role-free)", () => {
    renderBriefView({ markReady: vi.fn() });
    expect(screen.getAllByText("Viewed").length).toBeGreaterThan(0);
  });

  it("progress reaches 100% from chunk read-through alone (flags excluded in own-draft)", () => {
    renderBriefView({ markReady: vi.fn() });
    // View every chunk — with dispositions unreachable, chunks are the whole
    // denominator; counting flags would cap this below 100% forever.
    for (const viewed of screen.getAllByText("Viewed")) {
      const input = viewed.closest("label")?.querySelector("input");
      if (input) fireEvent.click(input);
    }
    const bar = document.querySelector('header div[style*="--progress-width"]');
    expect(bar?.getAttribute("style")).toContain("100%");
  });

  it("soft gate: flags on the Brief → the CTA opens the modal, nothing posted yet", () => {
    const markReady = vi.fn();
    renderBriefView({ markReady });
    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    expect(screen.getByText("Before marking ready")).toBeTruthy();
    expect(markReady).toHaveBeenCalledTimes(0);
    // "Mark ready anyway" — one click runs the mutation.
    fireEvent.click(screen.getByRole("button", { name: "Mark ready anyway" }));
    expect(markReady).toHaveBeenCalledTimes(1);
  });

  it("soft gate: zero flags AND zero drafts → the modal is skipped entirely, the CTA acts directly", () => {
    // The direct bypass survives the owner amendment only when there is
    // nothing to gate on at all — no flags and no unposted drafts.
    const markReady = vi.fn(() =>
      Promise.resolve<MarkReadyResult>({ kind: "ready" }),
    );
    renderBriefView({ markReady }, flaglessBrief);
    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    expect(screen.queryByText("Before marking ready")).toBeNull();
    expect(markReady).toHaveBeenCalledTimes(1);
  });

  it("soft gate: intent gaps ALONE never open the modal (BRIEF-54 — the fallible signal never drives the gate)", () => {
    // A flagless, draft-free Brief that DOES carry precise stated-but-missing
    // intent asks. The intent check is the AI's fallible read; it surfaces as
    // a secondary line inside the gate, but must never be the thing that opens
    // it — the CTA still acts directly.
    const intentGapBrief: Brief = {
      ...flaglessBrief,
      intentCheck: {
        ticketUrls: ["https://tracker.example/T-1"],
        specificity: "precise",
        scopeNote: "",
        accomplished: [],
        statedButMissing: [
          {
            intent: "document the endpoint",
            quote: "and document it",
            sourceUrl: "https://tracker.example/T-1",
            groupIds: [],
          },
        ],
        doneButUnstated: [],
      },
    };
    const markReady = vi.fn(() =>
      Promise.resolve<MarkReadyResult>({ kind: "ready" }),
    );
    renderBriefView({ markReady }, intentGapBrief);
    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    expect(screen.queryByText("Before marking ready")).toBeNull();
    expect(markReady).toHaveBeenCalledTimes(1);
  });

  it("soft gate: the intent line rides an open gate, and clicking it closes the gate AND expands the intent bar", () => {
    // The gate opens because of the flags (briefFixture carries them); the
    // BRIEF-54 intent line rides inside, proving the caller's computed
    // intentGapCount flows through. Clicking it dismisses the gate and, after
    // the deferred handle fires, lands the author on the EXPANDED intent bar —
    // pinning the full jumpToIntentGapsFromGate glue (setViewMode/setFocusMode
    // + setTimeout → expandAndScrollTo), not just the close.
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const briefWithGaps: Brief = {
      ...briefFixture,
      intentCheck: {
        ticketUrls: ["https://tracker.example/T-1"],
        specificity: "precise",
        scopeNote: "",
        accomplished: [],
        statedButMissing: [
          {
            intent: "add the docs",
            quote: "document it",
            sourceUrl: "https://tracker.example/T-1",
            groupIds: [],
          },
        ],
        doneButUnstated: [],
      },
    };
    renderBriefView({ markReady: vi.fn() }, briefWithGaps);
    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    // Scope to the mark-ready modal (several dialogs exist in the tree).
    const gate = screen
      .getByText("Before marking ready")
      .closest("[data-state]");
    expect(gate?.getAttribute("data-state")).toBe("open");
    // The bar is mounted (story/full/non-focus default) but collapsed.
    const barToggle = screen.getByRole("button", { name: /intent check/i });
    expect(barToggle).toHaveProperty("ariaExpanded", "false");

    fireEvent.click(screen.getByText("1 stated ask not found in the diff"));
    // The Modal keeps its DOM but goes inert/closed; the gate is dismissed.
    expect(gate?.getAttribute("data-state")).toBe("closed");
    // The deferred handle fires on the next tick: bar expands + scrolls.
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(barToggle).toHaveProperty("ariaExpanded", "true");
    expect(scrollIntoView).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("soft gate: zero flags but unposted drafts → the gate OPENS with the checkbox, batch posts then mark-ready", async () => {
    // Owner amendment (live bug, PR 9 test): the flags-only bypass skipped
    // the gate on a zero-flag brief, so the post-my-drafts checkbox was
    // unreachable — drafts silently stayed local while the PR went ready.
    // The batch expectation is global: drafts alone open the gate.
    writeSnapshot({
      briefId: "own-draft-test",
      dispositions: {},
      dominants: {},
      reclassifiedGroupIds: [],
      reviewedChunkIds: [],
      reviewComments: [
        comment("c1", "chunk-a", "draft"),
        comment("c2", "chunk-b", "draft"),
      ],
      reviewOutcome: "comment",
    });
    const markReady = vi.fn(() =>
      Promise.resolve<MarkReadyResult>({ kind: "ready" }),
    );
    const postComment = vi.fn((_anchor, _body) =>
      Promise.resolve<PostCommentResult>({ kind: "posted", commentId: 1 }),
    );
    renderBriefView({ markReady, postComment }, flaglessBrief);
    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    // The gate opened — nothing posted, nothing marked ready yet…
    expect(screen.getByText("Before marking ready")).toBeTruthy();
    expect(markReady).toHaveBeenCalledTimes(0);
    // …with the drafts-focused advisory, NOT risk-flag copy over an empty list.
    expect(
      await screen.findByText("You have 2 unposted draft comments."),
    ).toBeTruthy();
    expect(screen.queryByText(/these risk flags/i)).toBeNull();

    // The checkbox is reachable and the batch works end to end.
    fireEvent.click(
      screen.getByRole("checkbox", { name: /post my 2 draft comments/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark ready anyway" }));
    await waitFor(() => expect(markReady).toHaveBeenCalledTimes(1));
    expect(postComment).toHaveBeenCalledTimes(2);
  });

  it("failure: toast copy through the live region, CTA re-enabled, state kept", async () => {
    const markReady = vi.fn(() =>
      Promise.resolve<MarkReadyResult>({ kind: "upstream" }),
    );
    renderBriefView({ markReady }, flaglessBrief);
    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    await waitFor(() =>
      expect(screen.getByText(MARK_READY_COPY.upstream)).toBeTruthy(),
    );
    // Stay in-state: the chip is still up and the CTA is re-enabled (the CTA
    // is never hard-disabled — aria-disabled is the pending signal).
    expect(screen.getByText(CHIP_COPY)).toBeTruthy();
    const cta = screen.getByRole("button", { name: "Mark ready for review" });
    expect(cta.getAttribute("aria-disabled")).toBe("false");
  });

  it("soft gate: pending mutation → the CTA does NOT reopen the gate", async () => {
    // A mutation that never settles: pending holds while we click again.
    const markReady = vi.fn(() => new Promise<MarkReadyResult>(() => {}));
    renderBriefView({ markReady });
    // Through the gate once: flags exist, so the CTA opens the modal and
    // "Mark ready anyway" starts the mutation.
    fireEvent.click(markReadyCta());
    fireEvent.click(screen.getByRole("button", { name: "Mark ready anyway" }));
    expect(markReady).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(markReadyCta().getAttribute("aria-disabled")).toBe("true"),
    );

    // The CTA is aria-disabled (not hard disabled), so this click lands in
    // requestMarkReady — it must not reopen the gate over the in-flight
    // mutation (whose "Mark ready anyway" would silently no-op).
    fireEvent.click(markReadyCta());
    expect(overlayState("Before marking ready")).toBe("closed");
    expect(markReady).toHaveBeenCalledTimes(1);
  });

  it("soft gate: counts only unposted drafts; the jump link closes the gate and lands on the first draft's chunk", async () => {
    // Seed the persisted session for THIS briefId: two drafts + one already
    // posted — only the drafts may count.
    writeSnapshot({
      briefId: "own-draft-test",
      dispositions: {},
      dominants: {},
      reclassifiedGroupIds: [],
      reviewedChunkIds: [],
      reviewComments: [
        comment("c1", "chunk-b", "draft"),
        comment("c2", "chunk-a", "draft"),
        comment("c3", "chunk-a", "submitted"),
      ],
      reviewOutcome: "comment",
    });
    renderBriefView({ markReady: vi.fn() });
    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    // 2, not 3: the submitted comment is already on GitHub.
    expect(
      await screen.findByText("You have 2 unposted draft comments."),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: /jump to your drafts/i }),
    );
    // The gate closes and the FIRST draft's chunk becomes the active one.
    expect(overlayState("Before marking ready")).toBe("closed");
    await waitFor(() =>
      expect(
        document.getElementById("chunk-b")?.hasAttribute("data-current"),
      ).toBe(true),
    );
  });

  it("batch (checked, all succeed): posts every draft, THEN marks ready", async () => {
    writeSnapshot({
      briefId: "own-draft-test",
      dispositions: {},
      dominants: {},
      reclassifiedGroupIds: [],
      reviewedChunkIds: [],
      reviewComments: [
        comment("c1", "chunk-a", "draft"),
        comment("c2", "chunk-b", "draft"),
      ],
      reviewOutcome: "comment",
    });
    const markReady = vi.fn(() =>
      Promise.resolve<MarkReadyResult>({ kind: "ready" }),
    );
    const postComment = vi.fn((_anchor, _body) =>
      Promise.resolve<PostCommentResult>({ kind: "posted", commentId: 1 }),
    );
    renderBriefView({ markReady, postComment });
    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    expect(
      await screen.findByText("You have 2 unposted draft comments."),
    ).toBeTruthy();
    // Opt in, then confirm.
    fireEvent.click(
      screen.getByRole("checkbox", { name: /post my 2 draft comments/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark ready anyway" }));
    // Every draft posted through the per-comment path, then mark-ready ran.
    await waitFor(() => expect(markReady).toHaveBeenCalledTimes(1));
    expect(postComment).toHaveBeenCalledTimes(2);
  });

  it("batch (checked, one fails midway): posts STOP, mark-ready NOT called, honest-counts toast", async () => {
    writeSnapshot({
      briefId: "own-draft-test",
      dispositions: {},
      dominants: {},
      reclassifiedGroupIds: [],
      reviewedChunkIds: [],
      reviewComments: [
        comment("c1", "chunk-a", "draft"),
        comment("c2", "chunk-b", "draft"),
        comment("c3", "chunk-a", "draft"),
      ],
      reviewOutcome: "comment",
    });
    const markReady = vi.fn(() =>
      Promise.resolve<MarkReadyResult>({ kind: "ready" }),
    );
    let call = 0;
    const postComment = vi.fn((_anchor, _body) => {
      call += 1;
      // The second post fails — the batch must stop before the third.
      return Promise.resolve<PostCommentResult>(
        call === 2 ? { kind: "upstream" } : { kind: "posted", commentId: call },
      );
    });
    renderBriefView({ markReady, postComment });
    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    expect(
      await screen.findByText("You have 3 unposted draft comments."),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /post my 3 draft comments/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark ready anyway" }));

    // Honest counts, indeterminate for the one that failed (upstream is an
    // around-the-write failure), PR not marked ready.
    const summary = markReadyBatchFailureCopy(1, 3, "indeterminate");
    expect(await screen.findByText(summary)).toBeTruthy();
    // Reviewer round 1 #1/#3: the summary must be the SETTLED live-region
    // message, not a transient 30ms window — flush the failed post's drain
    // (endInFlightPost re-render → applySettledPosts) and every pending
    // clear-then-set announce tick, then assert the summary still stands and
    // the per-comment upstream copy never took the region over.
    await act(() => new Promise((resolve) => setTimeout(resolve, 120)));
    expect(screen.getByText(summary)).toBeTruthy();
    expect(screen.queryByText(POST_COMMENT_COPY.upstream)).toBeNull();
    // Stopped at the failure: the third draft was never attempted…
    expect(postComment).toHaveBeenCalledTimes(2);
    // …and mark-ready never ran.
    expect(markReady).toHaveBeenCalledTimes(0);
    // The gate closed on the failure.
    expect(overlayState("Before marking ready")).toBe("closed");
  });

  it("batch (checked, deterministic 400 midway): the summary says rejected-before-posting, not indeterminate", async () => {
    // Reviewer round 2 #2: an `invalid` route reject is deterministic — the
    // comment definitively did NOT post, so the summary must be actionable
    // ("edit the draft"), never the indeterminate check-GitHub warning.
    writeSnapshot({
      briefId: "own-draft-test",
      dispositions: {},
      dominants: {},
      reclassifiedGroupIds: [],
      reviewedChunkIds: [],
      reviewComments: [
        comment("c1", "chunk-a", "draft"),
        comment("c2", "chunk-b", "draft"),
      ],
      reviewOutcome: "comment",
    });
    const markReady = vi.fn(() =>
      Promise.resolve<MarkReadyResult>({ kind: "ready" }),
    );
    let call = 0;
    const postComment = vi.fn((_anchor, _body) => {
      call += 1;
      return Promise.resolve<PostCommentResult>(
        call === 2 ? { kind: "invalid" } : { kind: "posted", commentId: call },
      );
    });
    renderBriefView({ markReady, postComment });
    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    expect(
      await screen.findByText("You have 2 unposted draft comments."),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /post my 2 draft comments/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark ready anyway" }));

    expect(
      await screen.findByText(markReadyBatchFailureCopy(1, 2, "rejected")),
    ).toBeTruthy();
    // Not the indeterminate wording — the reject was deterministic.
    expect(screen.queryByText(/may or may not have posted/)).toBeNull();
    expect(markReady).toHaveBeenCalledTimes(0);
  });

  it("batch (checked, guard-blocked draft): no per-comment noise, the deterministic summary is the message", async () => {
    // Reviewer round 2 #1: a guard-path rejection (over-cap body — the
    // deterministic-400 mirror) inside a batch must not announce its blocked
    // reason before the summary; the summary carries the stop-cause.
    writeSnapshot({
      briefId: "own-draft-test",
      dispositions: {},
      dominants: {},
      reclassifiedGroupIds: [],
      reviewedChunkIds: [],
      reviewComments: [
        comment("c1", "chunk-a", "draft"),
        { ...comment("c2", "chunk-b", "draft"), body: "x".repeat(65_537) },
      ],
      reviewOutcome: "comment",
    });
    const markReady = vi.fn(() =>
      Promise.resolve<MarkReadyResult>({ kind: "ready" }),
    );
    const postComment = vi.fn((_anchor, _body) =>
      Promise.resolve<PostCommentResult>({ kind: "posted", commentId: 1 }),
    );
    renderBriefView({ markReady, postComment });
    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    expect(
      await screen.findByText("You have 2 unposted draft comments."),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /post my 2 draft comments/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark ready anyway" }));

    // The guard rejected pre-network: only the first draft was sent, the
    // deterministic summary is announced…
    expect(
      await screen.findByText(markReadyBatchFailureCopy(1, 2, "rejected")),
    ).toBeTruthy();
    expect(postComment).toHaveBeenCalledTimes(1);
    expect(markReady).toHaveBeenCalledTimes(0);
    // …and the per-comment blocked reason never injected noise into the live
    // region (the thread still shows it inline next to its disabled Post —
    // that adjacency is unchanged): after the drain + announce ticks settle,
    // the toast reads exactly the summary.
    await act(() => new Promise((resolve) => setTimeout(resolve, 120)));
    const toast = screen
      .getByText(markReadyBatchFailureCopy(1, 2, "rejected"))
      .closest('[data-state="visible"]');
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toBe(
      markReadyBatchFailureCopy(1, 2, "rejected"),
    );
  });

  it("batch failure summary carries the failing cause's own recovery (401 sign-in, 409 reload)", async () => {
    // Reviewer round 3 #2: batch mode suppresses the per-comment copy, so the
    // summary is the ONLY message — a blanket "edit the draft" is wrong for a
    // session expiry or a stale head. Each deterministic cause branches.
    const cases = [
      { kind: "unauthorized", copy: /sign in again to continue/ },
      { kind: "stale", copy: /reload to post against the current diff/ },
    ] as const;
    for (const { kind, copy } of cases) {
      cleanup();
      window.sessionStorage.clear();
      writeSnapshot({
        briefId: "own-draft-test",
        dispositions: {},
        dominants: {},
        reclassifiedGroupIds: [],
        reviewedChunkIds: [],
        reviewComments: [comment("c1", "chunk-a", "draft")],
        reviewOutcome: "comment",
      });
      const markReady = vi.fn(() =>
        Promise.resolve<MarkReadyResult>({ kind: "ready" }),
      );
      const postComment = vi.fn((_anchor, _body) =>
        Promise.resolve<PostCommentResult>({ kind }),
      );
      renderBriefView({ markReady, postComment });
      fireEvent.click(
        screen.getByRole("button", { name: "Mark ready for review" }),
      );
      expect(
        await screen.findByText("You have 1 unposted draft comment."),
      ).toBeTruthy();
      fireEvent.click(
        screen.getByRole("checkbox", { name: /post my 1 draft comment/i }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Mark ready anyway" }),
      );

      const summary = markReadyBatchFailureCopy(0, 1, kind);
      expect(await screen.findByText(summary)).toBeTruthy();
      // The variant keeps the honest-counts prefix + NOT-marked-ready suffix
      // and carries the cause's own guidance.
      expect(summary).toMatch(/^Posted 0 of 1\./);
      expect(summary).toMatch(/The PR was NOT marked ready\.$/);
      expect(summary).toMatch(copy);
      expect(markReady).toHaveBeenCalledTimes(0);
    }
  });

  it("batch failure rescues focus from the closing gate onto the terminal-slot CTA", async () => {
    // Reviewer round 3 #1: the failure branch closes the gate while the modal
    // holds focus (the confirm CTA) — the box goes inert and focus drops with
    // NEITHER sibling rescue firing (state didn't exit, head didn't advance).
    writeSnapshot({
      briefId: "own-draft-test",
      dispositions: {},
      dominants: {},
      reclassifiedGroupIds: [],
      reviewedChunkIds: [],
      reviewComments: [
        comment("c1", "chunk-a", "draft"),
        comment("c2", "chunk-b", "draft"),
      ],
      reviewOutcome: "comment",
    });
    const markReady = vi.fn(() =>
      Promise.resolve<MarkReadyResult>({ kind: "ready" }),
    );
    const postComment = vi.fn((_anchor, _body) =>
      Promise.resolve<PostCommentResult>({ kind: "upstream" }),
    );
    renderBriefView({ markReady, postComment });
    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    expect(
      await screen.findByText("You have 2 unposted draft comments."),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /post my 2 draft comments/i }),
    );
    const confirm = screen.getByRole("button", { name: "Mark ready anyway" });
    confirm.focus();
    fireEvent.click(confirm);

    // The batch fails on the first post; the gate closes…
    expect(
      await screen.findByText(markReadyBatchFailureCopy(0, 2, "indeterminate")),
    ).toBeTruthy();
    expect(overlayState("Before marking ready")).toBe("closed");
    // …and focus lands on the terminal-slot CTA, never silently on <body>.
    await waitFor(() => expect(document.activeElement).toBe(markReadyCta()));
  });

  it("Escape is a no-op while the batch runs; the gate stays up with its progress", async () => {
    // Reviewer round 1 #2: Modal wires Escape to close only when a handler is
    // provided — mid-batch the gate withholds it, matching the disabled
    // controls, so progress feedback cannot vanish while writes continue.
    writeSnapshot({
      briefId: "own-draft-test",
      dispositions: {},
      dominants: {},
      reclassifiedGroupIds: [],
      reviewedChunkIds: [],
      reviewComments: [
        comment("c1", "chunk-a", "draft"),
        comment("c2", "chunk-b", "draft"),
      ],
      reviewOutcome: "comment",
    });
    const markReady = vi.fn(() =>
      Promise.resolve<MarkReadyResult>({ kind: "ready" }),
    );
    // A post that never settles: the batch stays running while we hit Escape.
    const postComment = vi.fn(
      (_anchor, _body) => new Promise<PostCommentResult>(() => {}),
    );
    renderBriefView({ markReady, postComment });
    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    expect(
      await screen.findByText("You have 2 unposted draft comments."),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /post my 2 draft comments/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark ready anyway" }));
    // The batch is running: progress on the confirm button (the text also
    // rides the modal's sr-only live region, hence findAllBy).
    expect(
      await screen.findByRole("button", { name: "Posting 1 of 2…" }),
    ).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    // Still open, progress still visible.
    expect(overlayState("Before marking ready")).toBe("open");
    expect(
      screen.getByRole("button", { name: "Posting 1 of 2…" }),
    ).toBeTruthy();
  });

  it("batch (unchecked): marks ready WITHOUT posting anything (existing behavior)", async () => {
    writeSnapshot({
      briefId: "own-draft-test",
      dispositions: {},
      dominants: {},
      reclassifiedGroupIds: [],
      reviewedChunkIds: [],
      reviewComments: [
        comment("c1", "chunk-a", "draft"),
        comment("c2", "chunk-b", "draft"),
      ],
      reviewOutcome: "comment",
    });
    const markReady = vi.fn(() =>
      Promise.resolve<MarkReadyResult>({ kind: "ready" }),
    );
    const postComment = vi.fn((_anchor, _body) =>
      Promise.resolve<PostCommentResult>({ kind: "posted", commentId: 1 }),
    );
    renderBriefView({ markReady, postComment });
    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    expect(
      await screen.findByText("You have 2 unposted draft comments."),
    ).toBeTruthy();
    // Leave the checkbox unchecked — confirm posts nothing.
    fireEvent.click(screen.getByRole("button", { name: "Mark ready anyway" }));
    await waitFor(() => expect(markReady).toHaveBeenCalledTimes(1));
    expect(postComment).toHaveBeenCalledTimes(0);
  });

  it("plan without an action (historical revision): CTA reads disabled, click announces, gate never mounts", async () => {
    // A plan with no `markReady` — the route withholds the action while a
    // historical revision is in view.
    renderBriefView({});
    const cta = markReadyCta();
    expect(cta.getAttribute("aria-disabled")).toBe("true");
    // Flags exist on this Brief, but the gate is not the viewed revision's
    // to show — nothing gate-shaped in the DOM, and the click explains.
    expect(screen.queryByText("Before marking ready")).toBeNull();
    fireEvent.click(cta);
    expect(
      await screen.findByText(/switch to the latest revision to mark/i),
    ).toBeTruthy();
    expect(screen.queryByText("Before marking ready")).toBeNull();
  });

  it("head advances while the gate is open: modal unmounts, flag resets, focus rescued, shortcuts revive", async () => {
    const { rerenderWith } = renderBriefView({ markReady: vi.fn() });
    fireEvent.click(markReadyCta());
    expect(overlayState("Before marking ready")).toBe("open");

    // The author pushes mid-gate: the poll advances meta.headSha, the route
    // keeps the plan (still the viewer's draft) but withholds the action —
    // no remount, the span keys the mount.
    rerenderWith({});
    expect(screen.queryByText("Before marking ready")).toBeNull();
    // The focus the unmounting modal held is rescued onto the slot CTA…
    expect(document.activeElement).toBe(markReadyCta());
    // …the live region explains the vanished check…
    await waitFor(() =>
      expect(screen.getByText(/newer commits/i)).toBeTruthy(),
    );
    // …and page shortcuts are not stuck disabled.
    fireEvent.keyDown(window, { key: "?" });
    expect(overlayState("Keyboard shortcuts")).toBe("open");
  });

  it("ready-elsewhere while the gate is open: the modal unmounts cleanly, focus rescued, announced, shortcuts revive, no resurrection", async () => {
    const { rerenderWith } = renderBriefView({ markReady: vi.fn() });
    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    expect(overlayState("Before marking ready")).toBe("open");

    // The PR is marked ready on GitHub while the gate is open: the refreshed
    // PrView ends the own-draft state and the gate goes with it.
    rerenderWith(undefined);
    expect(screen.queryByText("Before marking ready")).toBeNull();
    // The focus the unmounting modal held lands on the terminal slot (which
    // now holds Receipt), never silently on <body>…
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Receipt" }),
    );
    // …and the live region explains why the modal vanished.
    await waitFor(() =>
      expect(screen.getByText(/now ready for review/i)).toBeTruthy(),
    );
    // The open flag was RESET, not merely unmounted: page shortcuts are not
    // stuck disabled.
    fireEvent.keyDown(window, { key: "?" });
    expect(overlayState("Keyboard shortcuts")).toBe("open");
    fireEvent.keyDown(window, { key: "Escape" });

    // Converting back to draft later must not resurrect the gate.
    rerenderWith({ markReady: vi.fn() });
    expect(overlayState("Before marking ready")).toBe("closed");
  });

  it("vanishes the affordances when draft flips under a live session", () => {
    const { rerenderWith } = renderBriefView({ markReady: vi.fn() });
    expect(screen.getByText(CHIP_COPY)).toBeTruthy();
    // The refreshed PrView (draft=false) turns the plan undefined — the same
    // view swaps to reviewer affordances without remounting anything else.
    rerenderWith(undefined);
    expect(screen.queryByText(CHIP_COPY)).toBeNull();
    expect(screen.getByRole("button", { name: "Receipt" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Mark ready for review" }),
    ).toBeNull();
  });

  it("rescues focus from an unmounting overlay onto the terminal-slot CTA, with an announcement", async () => {
    const { rerenderWith } = renderBriefView(undefined);
    // Open the pre-submit overlay: the Modal claims focus on open.
    fireEvent.click(screen.getByRole("button", { name: "Receipt" }));
    expect(document.activeElement === document.body).toBe(false);

    // The PR converts to draft on GitHub while focus lives in the overlay:
    // the overlay unmounts (no blur fires) — focus must land on the
    // terminal-slot CTA instead of dropping to <body> silently…
    rerenderWith({ markReady: vi.fn() });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    // …and the live region explains why the screen just changed.
    await waitFor(() =>
      expect(screen.getByText(/converted to a draft/i)).toBeTruthy(),
    );
  });

  it("flip INTO own-draft under an open overlay: state clears, shortcuts revive, no resurrection", () => {
    const { rerenderWith } = renderBriefView(undefined);
    // Open the pre-submit overlay on the reviewer view (Receipt CTA).
    fireEvent.click(screen.getByRole("button", { name: "Receipt" }));
    expect(overlayState("Before the receipt")).toBe("open");

    // The PR converts to draft on GitHub under the open overlay.
    rerenderWith({ markReady: vi.fn() });
    expect(screen.queryByText("Before the receipt")).toBeNull();
    // The open flag was RESET, not merely unmounted: page shortcuts are not
    // stuck disabled — "?" opens the shortcuts modal.
    fireEvent.keyDown(window, { key: "?" });
    expect(overlayState("Keyboard shortcuts")).toBe("open");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(overlayState("Keyboard shortcuts")).toBe("closed");

    // Marked ready again: the pre-submit overlay must not resurrect.
    rerenderWith(undefined);
    expect(overlayState("Before the receipt")).toBe("closed");
  });
});
