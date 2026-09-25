// @vitest-environment jsdom
// The one-modal submit flow: verdict-first default view, receipt as pure
// preview, live blocked-reason against the store draft, and the stale-head
// submit ack (modal-local, resets on reopen).
import { appI18n } from "../../../../i18n/I18nProvider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createReviewFlowStore,
  type ReviewFlowStore,
} from "../../session/flow/store";
import { ReviewFlowProvider } from "../../session/flow/provider";
import type { Receipt } from "../../utils/receipt";
import { SubmitModal, type SubmitModalProps } from ".";

function receipt(): Receipt {
  return {
    subject: { repo: "octo/hello", number: 7, sha: "a".repeat(40) },
    progress: { reviewedChunks: 1, chunkTotal: 1, flagTotal: 0 },
    counts: { addressed: 0, dismissed: 0, open: 0 },
    addressed: [],
    dismissed: [],
    open: [],
    comments: [],
    reclassifiedCount: 0,
  };
}

function flowStore(): ReviewFlowStore {
  return createReviewFlowStore(
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
}

function baseProps(submit: () => void): SubmitModalProps {
  return {
    receipt: receipt(),
    open: true,
    close: vi.fn(),
    outcome: "comment",
    setOutcome: vi.fn(),
    submit,
    unresolvedItems: [],
    jumpToItem: vi.fn(),
  };
}

function renderModal(
  overrides: Partial<SubmitModalProps> = {},
  store: ReviewFlowStore = flowStore(),
) {
  const submit = vi.fn();
  const props = { ...baseProps(submit), ...overrides };
  const view = render(
    <ReviewFlowProvider store={store}>
      <SubmitModal {...props} />
    </ReviewFlowProvider>,
  );
  const rerender = (next: Partial<SubmitModalProps> = {}) => {
    view.rerender(
      <ReviewFlowProvider store={store}>
        <SubmitModal {...baseProps(submit)} {...next} />
      </ReviewFlowProvider>,
    );
  };
  return { view, submit, store, rerender };
}

/** A live blocked rule for tests: comment-only content gate, empty = blocked. */
const blockedWhenEmpty = (comment: string) =>
  comment.trim() === "" ? "A comment-only review needs content." : undefined;

const submitButton = () =>
  screen.getByRole("button", { name: /^submit review$/i });
const ackCheckbox = () =>
  screen.getByRole("checkbox", {
    name: /submit against the reviewed revision anyway/i,
  });

describe("SubmitModal views", () => {
  // No vitest globals in this repo → testing-library does not auto-cleanup.
  afterEach(cleanup);

  it("defaults to the verdict view: picker, comment field, submit", () => {
    renderModal();
    expect(screen.getByRole("radio", { name: "Comment" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Request changes" })).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: /review comment/i }),
    ).toBeTruthy();
    expect(submitButton()).toBeTruthy();
    expect(screen.queryByText(/not an approval/i)).toBeNull();
  });

  it("navigates verdict → receipt → back, moving focus to the heading", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /preview receipt/i }));
    expect(screen.getByText(/not an approval/i)).toBeTruthy();
    // The accordion view: outcome pinned, coverage open, raw behind a fold.
    expect(screen.getByText("Review outcome")).toBeTruthy();
    expect(
      screen.getByText(/what the reviewer covered/i).closest("details")?.open,
    ).toBe(true);
    expect(screen.getByText(/show raw receipt/i)).toBeTruthy();
    expect(screen.getByText(/not checked:/i)).toBeTruthy();
    // The receipt is a pure preview: no submit control on this view.
    expect(
      screen.queryByRole("button", { name: /^submit review$/i }),
    ).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: /verification receipt/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /back to verdict/i }));
    expect(submitButton()).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: /submit review/i }),
    );
  });

  it("keeps the review comment across a receipt preview and back", () => {
    renderModal();
    const field = screen.getByRole("textbox", { name: /review comment/i });
    fireEvent.change(field, { target: { value: "worth a second look" } });
    fireEvent.click(screen.getByRole("button", { name: /preview receipt/i }));
    fireEvent.click(screen.getByRole("button", { name: /back to verdict/i }));
    expect(
      screen.getByRole("textbox", { name: /review comment/i }).textContent,
    ).toBe("worth a second look");
  });

  it("names the dialog per view and closes on Escape from the receipt", () => {
    const close = vi.fn();
    renderModal({ close });
    expect(screen.getByRole("dialog", { name: /submit review/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /preview receipt/i }));
    expect(
      screen.getByRole("dialog", { name: /verification receipt/i }),
    ).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalled();
  });

  it("reopening lands on the verdict view again", () => {
    const { rerender } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /preview receipt/i }));
    rerender({ open: false });
    rerender({ open: true });
    expect(submitButton()).toBeTruthy();
    // Reopen is the Modal's focus claim (the dialog box), NOT a view switch:
    // the heading-focus effect must not fire on this path.
    expect(document.activeElement).not.toBe(
      screen.getByRole("heading", { name: /submit review/i }),
    );
  });

  it("Cmd/Ctrl+Enter from the comment field respects the disabled guard", () => {
    const { submit } = renderModal({ staleHead: true });
    const textbox = screen.getByRole("textbox", { name: /review comment/i });
    fireEvent.keyDown(textbox, { key: "Enter", metaKey: true });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(ackCheckbox());
    fireEvent.keyDown(textbox, { key: "Enter", metaKey: true });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("selecting an outcome radio forwards to setOutcome", () => {
    const setOutcome = vi.fn();
    renderModal({ setOutcome });
    fireEvent.click(screen.getByRole("radio", { name: "Approve" }));
    expect(setOutcome).toHaveBeenCalledWith("approve");
  });

  it("edits the store draft and re-derives the live blocked reason", () => {
    const { submit, store } = renderModal({
      blockedReasonWith: blockedWhenEmpty,
    });
    const button = submitButton();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(submit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: /review comment/i }), {
      target: { value: "Looks fine overall." },
    });
    expect(store.getState().reviewComment).toBe("Looks fine overall.");
    expect(button.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(button);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("the override reason wins over the live rule and describes the button", () => {
    const { submit } = renderModal({
      blockedReasonOverride: "Historical revision — read-only.",
      blockedReasonWith: () => undefined,
    });
    const button = submitButton();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-describedby")).toBe(
      "submit-modal-blocked",
    );
    expect(screen.getByText(/historical revision — read-only/i)).toBeTruthy();
    fireEvent.click(button);
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("SubmitModal advisory view", () => {
  afterEach(cleanup);

  const items = [
    {
      id: "flag:1",
      kind: "open-risk" as const,
      label: "auth: token refresh race",
      targetId: "chunk-a",
    },
    {
      id: "comment:2",
      kind: "draft-comment" as const,
      label: "src/a.ts:+3",
      targetId: "chunk-a",
    },
  ];

  it("lands on the advisory view when unresolved items exist", () => {
    renderModal({ unresolvedItems: items });
    expect(
      screen.getByRole("heading", { name: /before you submit/i }),
    ).toBeTruthy();
    expect(screen.getByText(/this is advisory/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /open risk/i })).toBeTruthy();
    // No submit control on the advisory stop.
    expect(
      screen.queryByRole("button", { name: /^submit review$/i }),
    ).toBeNull();
  });

  it("skips straight to the verdict view with nothing unresolved", () => {
    renderModal({ unresolvedItems: [] });
    expect(submitButton()).toBeTruthy();
  });

  it("Continue reaches the verdict view and receipt's Back returns there", () => {
    renderModal({ unresolvedItems: items });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(submitButton()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /preview receipt/i }));
    fireEvent.click(screen.getByRole("button", { name: /back to verdict/i }));
    // The advisory list is a stop, never a destination.
    expect(submitButton()).toBeTruthy();
  });

  it("jumping to an item hands the item to the screen", () => {
    const jumpToItem = vi.fn();
    renderModal({ unresolvedItems: items, jumpToItem });
    fireEvent.click(screen.getByRole("button", { name: /open risk/i }));
    expect(jumpToItem).toHaveBeenCalledWith(items[0]);
  });

  it("captures the items at open: a mid-flow prop change never reshuffles", () => {
    const { rerender } = renderModal({ unresolvedItems: items });
    rerender({ unresolvedItems: [] });
    // Still on the advisory view, still listing the captured items.
    expect(screen.getByRole("button", { name: /open risk/i })).toBeTruthy();
  });

  it("re-shows the advisory on reopen while items remain", () => {
    const { rerender } = renderModal({ unresolvedItems: items });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    rerender({ unresolvedItems: items, open: false });
    rerender({ unresolvedItems: items, open: true });
    const heading = screen.getByRole("heading", {
      name: /before you submit/i,
    });
    expect(heading).toBeTruthy();
    // Reopen onto the ADVISORY entry view is still the Modal's open-focus
    // claim, not a view switch, the heading-focus effect must stay quiet
    // (pins the prevViewRef reset to the ENTRY view, not "verdict").
    expect(document.activeElement).not.toBe(heading);
  });

  it("lists unread unattributed lines as advisory and lets Continue through", () => {
    renderModal({
      unresolvedItems: [
        {
          id: "remainder:u-7e7f21ef",
          kind: "unreviewed-remainder",
          label: "src/orphan.ts",
          targetId: "u-7e7f21ef",
        },
      ],
    });

    expect(
      screen.getByRole("button", { name: /unread unattributed lines/i }),
    ).toBeTruthy();
    expect(screen.getByText("src/orphan.ts")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /^submit review$/i }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(submitButton()).toBeTruthy();
  });
});

describe("SubmitModal stale-head ack", () => {
  afterEach(cleanup);

  it("renders no ack UI and submits directly when the view is current", () => {
    const { submit } = renderModal();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/newer commits/i)).toBeNull();
    fireEvent.click(submitButton());
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("gates Submit behind the ack when the view is stale", () => {
    const { submit } = renderModal({ staleHead: true });
    expect(
      screen.getByText(/comments will anchor to the revision you reviewed/i),
    ).toBeTruthy();
    const button = submitButton();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    // The disabled control points at the warning so AT hears WHY it is off.
    expect(button.getAttribute("aria-describedby")).toBe(
      "submit-modal-stale-warning",
    );
    fireEvent.click(button);
    expect(submit).not.toHaveBeenCalled();
  });

  it("acknowledging re-enables Submit", () => {
    const { submit } = renderModal({ staleHead: true });
    fireEvent.click(ackCheckbox());
    const button = submitButton();
    expect(button.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(button);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("resets the ack when the modal reopens", () => {
    const { submit, rerender } = renderModal({ staleHead: true });
    fireEvent.click(ackCheckbox());
    rerender({ staleHead: true, open: false });
    rerender({ staleHead: true, open: true });
    const box = ackCheckbox();
    expect(box).toHaveProperty("checked", false);
    fireEvent.click(submitButton());
    expect(submit).not.toHaveBeenCalled();
  });

  it("re-requires the ack when staleness returns while open", () => {
    const { submit, rerender } = renderModal({ staleHead: true });
    fireEvent.click(ackCheckbox());
    rerender({ staleHead: false });
    rerender({ staleHead: true });
    expect(ackCheckbox()).toHaveProperty("checked", false);
    fireEvent.click(submitButton());
    expect(submit).not.toHaveBeenCalled();
  });

  it("clears the ack UI when staleness flips off while open", () => {
    const { submit, rerender } = renderModal({ staleHead: true });
    rerender({ staleHead: false });
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(submitButton());
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("an external blocked reason keeps precedence over the stale ack", () => {
    const { submit } = renderModal({
      staleHead: true,
      blockedReasonOverride: "A comment is still posting.",
    });
    fireEvent.click(ackCheckbox());
    const button = submitButton();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-describedby")).toBe(
      "submit-modal-blocked",
    );
    fireEvent.click(button);
    expect(submit).not.toHaveBeenCalled();
  });
});
