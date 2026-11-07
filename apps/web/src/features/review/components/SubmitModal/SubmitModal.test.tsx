// @vitest-environment jsdom
// The one-modal submit flow: verdict-first default view, receipt as pure
// preview, live blocked-reason against the store draft, and the stale-head
// submit ack (modal-local, resets on reopen).
import { appI18n } from "../../../../i18n/I18nProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { MentionCandidateKinds } from "@web/components/MarkdownTextarea/types";
import {
  compileStylesheet,
  parseCompiledRules,
  resolveInheritedDeclaration,
  scopeCompiledRules,
} from "@web/test/compiled-css";
import rowButtonStyles from "@web/components/RowButton/RowButton.module.scss";

import {
  createReviewFlowStore,
  type ReviewFlowStore,
} from "../../session/flow/store";
import { ReviewFlowProvider } from "../../session/flow/provider";
import type { Receipt } from "../../utils/receipt";
import { SubmitModal, type SubmitModalProps } from ".";
import styles from "./SubmitModal.module.scss";

const ROW_BUTTON_STYLESHEET = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../components/RowButton/RowButton.module.scss",
);

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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrap = (modal: ReactNode) => (
    <QueryClientProvider client={client}>
      <ReviewFlowProvider store={store}>{modal}</ReviewFlowProvider>
    </QueryClientProvider>
  );
  const view = render(wrap(<SubmitModal {...props} />));
  const rerender = (next: Partial<SubmitModalProps> = {}) => {
    view.rerender(wrap(<SubmitModal {...baseProps(submit)} {...next} />));
  };
  return { view, submit, store, rerender };
}

/** A live blocked rule for tests: comment-only content gate, empty = blocked. */
const blockedWhenEmpty = (comment: string) =>
  comment.trim() === "" ? "A comment-only review needs content." : undefined;

const submitButton = () =>
  screen.getByRole("button", { name: /^submit review$/i });
function getBlockedReason() {
  return screen.getByText("A comment-only review needs content.");
}
const ackCheckbox = () =>
  screen.getByRole("checkbox", {
    name: /submit against the reviewed revision anyway/i,
  });

describe("SubmitModal views", () => {
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
    // Plain rows first, the rest under one closed Details disclosure.
    expect(screen.getByText("Review outcome")).toBeTruthy();
    expect(screen.getByText("Details").closest("details")?.open).toBe(false);
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

  it("says the receipt stays off GitHub, not that only the signature posts", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /preview receipt/i }));

    expect(
      screen.getByText(
        "Your review as it stands at submit. This receipt is not posted to GitHub; its counts go on the signature line in your review.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/only the one-line signature/i)).toBeNull();
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

  it("scrolls the receipt's folds and keeps its actions out of the scroll", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /preview receipt/i }));

    const dialog = screen.getByRole("dialog", {
      name: /verification receipt/i,
    });
    const body = within(dialog).getByTestId("receipt-body");
    expect(within(body).getByText(/show raw receipt/i)).toBeTruthy();
    const back = screen.getByRole("button", { name: /back to verdict/i });
    expect(body.contains(back)).toBe(false);
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

  it("shows why Submit is off only once someone tries it", () => {
    renderModal({ blockedReasonWith: blockedWhenEmpty });
    expect(getBlockedReason().classList.contains("sr-only")).toBe(true);
    expect(submitButton().getAttribute("aria-describedby")).toBe(
      "submit-modal-blocked",
    );

    fireEvent.click(submitButton());

    expect(getBlockedReason().classList.contains("sr-only")).toBe(false);
    expect(getBlockedReason().id).toBe("submit-modal-blocked");
  });

  it("shows why Submit is off once Cmd+Enter tries it", () => {
    const { submit } = renderModal({ blockedReasonWith: blockedWhenEmpty });
    const textbox = screen.getByRole("textbox", { name: /review comment/i });

    fireEvent.keyDown(textbox, { key: "Enter", metaKey: true });

    expect(getBlockedReason().classList.contains("sr-only")).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it("announces why Submit is off on every refused try", async () => {
    const { store } = renderModal({ blockedReasonWith: blockedWhenEmpty });
    const textbox = screen.getByRole("textbox", { name: /review comment/i });
    const reason = "A comment-only review needs content.";

    fireEvent.keyDown(textbox, { key: "Enter", metaKey: true });
    await vi.waitFor(() => {
      expect(store.getState().liveMessage).toBe(reason);
    });
    fireEvent.click(submitButton());

    expect(store.getState().liveMessage).toBe("");
    await vi.waitFor(() => {
      expect(store.getState().liveMessage).toBe(reason);
    });
  });

  it("keeps a Submit in flight disabled-looking and inert", () => {
    const { submit } = renderModal({ submitPending: true });
    const button = screen.getByRole("button", { name: /^submitting/i });

    fireEvent.click(button);

    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(submit).not.toHaveBeenCalled();
  });

  it("hides the blocked reason again after a close and reopen", () => {
    const { rerender } = renderModal({ blockedReasonWith: blockedWhenEmpty });
    fireEvent.click(submitButton());

    rerender({ blockedReasonWith: blockedWhenEmpty, open: false });
    rerender({ blockedReasonWith: blockedWhenEmpty, open: true });

    expect(getBlockedReason().classList.contains("sr-only")).toBe(true);
  });

  it("keeps the tried reason shown across a receipt preview and back", () => {
    renderModal({ blockedReasonWith: blockedWhenEmpty });
    fireEvent.click(submitButton());

    fireEvent.click(screen.getByRole("button", { name: /preview receipt/i }));
    fireEvent.click(screen.getByRole("button", { name: /back to verdict/i }));

    expect(getBlockedReason().classList.contains("sr-only")).toBe(false);
  });

  it("Submit holds while the comment still carries an upload placeholder", () => {
    const { submit } = renderModal();
    fireEvent.change(screen.getByRole("textbox", { name: /review comment/i }), {
      target: { value: "see\n![Uploading shot.png…]()" },
    });

    fireEvent.click(submitButton());

    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "An image is still uploading; wait for it to land before submitting.",
    );

    fireEvent.change(screen.getByRole("textbox", { name: /review comment/i }), {
      target: { value: "see\n![Image](https://x/y.png)" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(submitButton());
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
    expect(
      screen.getByText(/you can continue; the summary shows unresolved items/i),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /open risk/i })).toBeTruthy();
    // No submit control on the advisory stop.
    expect(
      screen.queryByRole("button", { name: /^submit review$/i }),
    ).toBeNull();
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

  it("sets a risk's attribute apart from its mono file path", () => {
    renderModal({
      unresolvedItems: [
        {
          id: "risk:hot-path",
          kind: "open-risk",
          label: "src/a.ts",
          riskAttribute: "Hot path",
          targetId: "chunk-a",
        },
      ],
    });

    const row = screen.getByRole("button", { name: /open risk/i });
    const attribute = within(row).getByText(/^Hot path/);
    expect(attribute.className).toBe(styles["riskAttribute"]);
  });

  it("sets a risk's attribute in its path's size and colour", () => {
    renderModal({
      unresolvedItems: [
        {
          id: "risk:hot-path",
          kind: "open-risk",
          label: "src/a.ts",
          riskAttribute: "Hot path",
          targetId: "chunk-a",
        },
      ],
    });
    const css = compileStylesheet(ROW_BUTTON_STYLESHEET);
    const rules = scopeCompiledRules(parseCompiledRules(css), rowButtonStyles);

    const row = screen.getByRole("button", { name: /open risk/i });
    const kind = within(row).getByText("Open risk");
    const attribute = within(row).getByText(/^Hot path/);
    const path = row.querySelector("b")!;

    for (const property of ["font-size", "color"]) {
      expect(resolveInheritedDeclaration(attribute, rules, property)).toBe(
        resolveInheritedDeclaration(path, rules, property),
      );
    }
    expect(resolveInheritedDeclaration(kind, rules, "font-size")).toBe(
      "var(--font-size-sm)",
    );
    expect(resolveInheritedDeclaration(kind, rules, "color")).toBe(
      "var(--color-text-3)",
    );
  });
});

describe("SubmitModal stale-head ack", () => {
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

  it("announces the newer commits warning when Cmd+Enter is refused", async () => {
    const { store, submit } = renderModal({ staleHead: true });
    const textbox = screen.getByRole("textbox", { name: /review comment/i });

    fireEvent.keyDown(textbox, { key: "Enter", metaKey: true });

    await vi.waitFor(() => {
      expect(store.getState().liveMessage).toBe(
        appI18n.t("review.submit.staleWarning"),
      );
    });
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

describe("SubmitModal mention suggestions", () => {
  const participants = [
    { kind: MentionCandidateKinds.USER, login: "alice" },
    { kind: MentionCandidateKinds.USER, login: "bob" },
  ] as const;

  function typeComment(text: string) {
    fireEvent.change(screen.getByRole("textbox", { name: /review comment/i }), {
      target: { value: text },
    });
  }

  it("floats the review body's list and selects from the keyboard", () => {
    renderModal({ mentionSource: { participants } });
    const input = screen.getByRole("textbox", { name: /review comment/i });

    typeComment("Thanks @");
    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(
      screen.getByRole("listbox").parentElement?.getAttribute("data-variant"),
    ).toBe("floating");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: "@bob" }).id,
    );

    fireEvent.keyDown(input, { key: "Enter" });

    expect(input).toHaveProperty("value", "Thanks @bob ");
  });
});
