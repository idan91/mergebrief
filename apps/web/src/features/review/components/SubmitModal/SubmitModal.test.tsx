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
import modalStyles from "@web/components/Modal/Modal.module.scss";
import rowStyles from "@web/components/Modal/UnresolvedRow/UnresolvedRow.module.scss";

import {
  createReviewFlowStore,
  type ReviewFlowStore,
} from "../../session/flow/store";
import { ReviewFlowProvider } from "../../session/flow/provider";
import type { Receipt } from "../../utils/receipt";
import { SubmitModal, type SubmitModalProps } from ".";

const ROW_STYLESHEET = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../components/Modal/UnresolvedRow/UnresolvedRow.module.scss",
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
    expect(screen.getByText("Review outcome")).toBeTruthy();
    expect(
      screen.getByRole("tablist", { name: /receipt sections/i }),
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: /verification receipt/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(submitButton()).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: /submit review/i }),
    );
  });

  it("submits from the receipt under the verdict view's rules", () => {
    const { submit } = renderModal({ blockedReasonWith: blockedWhenEmpty });
    fireEvent.click(screen.getByRole("button", { name: /preview receipt/i }));

    fireEvent.click(submitButton());

    expect(submit).not.toHaveBeenCalled();
    expect(
      screen.getByText("A comment-only review needs content.").classList,
    ).not.toContain("sr-only");
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /review comment/i }), {
      target: { value: "Looks fine overall." },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview receipt/i }));
    fireEvent.click(submitButton());
    expect(submit).toHaveBeenCalledTimes(1);
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

  it("keeps a Submit in flight on the receipt disabled-looking and inert", () => {
    const { submit } = renderModal({ submitPending: true });
    fireEvent.click(screen.getByRole("button", { name: /preview receipt/i }));
    const button = screen.getByRole("button", { name: /^submitting/i });

    fireEvent.click(button);

    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(submit).not.toHaveBeenCalled();
  });

  it("keeps the review comment across a receipt preview and back", () => {
    renderModal();
    const field = screen.getByRole("textbox", { name: /review comment/i });
    fireEvent.change(field, { target: { value: "worth a second look" } });
    fireEvent.click(screen.getByRole("button", { name: /preview receipt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
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

  it("scrolls the receipt's sections and keeps its actions out of the scroll", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /preview receipt/i }));

    const dialog = screen.getByRole("dialog", {
      name: /verification receipt/i,
    });
    const body = within(dialog).getByTestId("receipt-body");
    expect(within(body).getByRole("tablist")).toBeTruthy();
    const back = screen.getByRole("button", { name: /^back$/i });
    expect(body.contains(back)).toBe(false);
    expect(body.contains(submitButton())).toBe(false);
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

  it("previews the receipt's tiles before an outcome is picked", () => {
    renderModal({ outcome: undefined });
    fireEvent.click(screen.getByRole("button", { name: /preview receipt/i }));

    expect(screen.queryByText("Review outcome")).toBeNull();
    expect(screen.getByText("Inline comments").parentElement?.textContent).toBe(
      "Inline comments0",
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
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));

    expect(getBlockedReason().classList.contains("sr-only")).toBe(false);
  });

  it("sends a stale head on the receipt Back to its acknowledgement", () => {
    const { submit } = renderModal({ staleHead: true });
    fireEvent.click(screen.getByRole("button", { name: /preview receipt/i }));

    fireEvent.click(submitButton());

    expect(submit).not.toHaveBeenCalled();
    expect(
      screen.getByText(/go back to confirm/i).classList.contains("sr-only"),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    fireEvent.click(ackCheckbox());
    fireEvent.click(submitButton());
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a stale head", { staleHead: true }, /go back to confirm/i],
    [
      "a refused comment",
      { blockedReasonWith: blockedWhenEmpty },
      /needs content/i,
    ],
  ])("announces the receipt's reason for %s", async (_case, props, reason) => {
    const { store } = renderModal(props);
    fireEvent.click(screen.getByRole("button", { name: /preview receipt/i }));

    fireEvent.click(submitButton());

    await vi.waitFor(() => {
      expect(store.getState().liveMessage).toMatch(reason);
    });
  });

  it("sends an unplaced upload on the receipt Back to the comment", () => {
    const { submit } = renderModal();
    fireEvent.change(screen.getByRole("textbox", { name: /review comment/i }), {
      target: { value: "see\n![Uploading shot.png…]()" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview receipt/i }));

    fireEvent.click(submitButton());

    expect(submit).not.toHaveBeenCalled();
    expect(
      screen.getByText(/go back to the comment/i).classList.contains("sr-only"),
    ).toBe(false);
  });

  it("Submit holds while the comment still carries an upload placeholder", () => {
    const { submit } = renderModal();
    fireEvent.change(screen.getByRole("textbox", { name: /review comment/i }), {
      target: { value: "see\n![Uploading shot.png…]()" },
    });

    fireEvent.click(submitButton());

    expect(submit).not.toHaveBeenCalled();
    expect(submitButton().getAttribute("aria-disabled")).toBe("true");
    expect(
      screen.getByText(
        "An image is still uploading; wait for it to land before submitting.",
      ).classList,
    ).not.toContain("sr-only");

    fireEvent.change(screen.getByRole("textbox", { name: /review comment/i }), {
      target: { value: "see\n![Image](https://x/y.png)" },
    });
    expect(screen.queryByText(/still uploading/)).toBeNull();
    fireEvent.click(submitButton());
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("ties an attach error to the review comment field", () => {
    renderModal();
    const textbox = screen.getByRole("textbox", { name: /review comment/i });
    fireEvent.change(textbox, {
      target: { value: "see\n![Uploading shot.png…]()" },
    });

    fireEvent.keyDown(textbox, { key: "Enter", metaKey: true });

    expect(textbox.getAttribute("aria-describedby")).toBe(
      screen.getByRole("alert").id,
    );
    expect(textbox.getAttribute("aria-invalid")).toBe("true");
  });

  it("drops the comment field's tie once the comment changes", () => {
    renderModal();
    const textbox = screen.getByRole("textbox", { name: /review comment/i });
    fireEvent.change(textbox, {
      target: { value: "see\n![Uploading shot.png…]()" },
    });
    fireEvent.keyDown(textbox, { key: "Enter", metaKey: true });

    fireEvent.change(textbox, { target: { value: "see" } });

    expect(textbox.hasAttribute("aria-describedby")).toBe(false);
    expect(textbox.hasAttribute("aria-invalid")).toBe(false);
  });

  it.each([
    ["Submit then Cmd+Enter", ["click", "keys"]],
    ["Cmd+Enter then Submit", ["keys", "click"]],
  ])("says an upload is pending once after %s", (_order, steps) => {
    renderModal();
    const textbox = screen.getByRole("textbox", { name: /review comment/i });
    fireEvent.change(textbox, {
      target: { value: "see\n![Uploading shot.png…]()" },
    });

    for (const step of steps) {
      if (step === "click") {
        fireEvent.click(submitButton());
      } else {
        fireEvent.keyDown(textbox, { key: "Enter", metaKey: true });
      }
    }

    const shownLines = screen
      .getAllByText(/still uploading/)
      .filter((line) => !line.classList.contains("sr-only"));
    expect(shownLines).toHaveLength(1);
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
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    // The advisory list is a stop, never a destination.
    expect(submitButton()).toBeTruthy();
  });

  it("jumping to an item hands the item to the screen", () => {
    const jumpToItem = vi.fn();
    renderModal({ unresolvedItems: items, jumpToItem });
    fireEvent.click(screen.getByRole("button", { name: /open risk/i }));
    expect(jumpToItem).toHaveBeenCalledWith(items[0]);
  });

  it("scrolls the advisory list alone, its header and actions outside", () => {
    renderModal({ unresolvedItems: items });
    const dialog = screen.getByRole("dialog", { name: /before you submit/i });
    const list = [...dialog.children].find(
      (child) => child.className === modalStyles["unresolvedList"],
    );
    const row = screen.getByRole("button", { name: /open risk/i });
    const heading = screen.getByRole("heading", { name: /before you submit/i });
    const continueButton = screen.getByRole("button", { name: /^continue$/i });

    expect(list?.contains(row)).toBe(true);
    expect(list?.contains(heading)).toBe(false);
    expect(list?.contains(continueButton)).toBe(false);
  });

  it("groups items by kind under a counted heading, in kind order", () => {
    renderModal({
      unresolvedItems: [
        {
          id: "comment:2",
          kind: "draft-comment",
          label: "src/a.ts:+3",
          targetId: "chunk-a",
        },
        ...items,
        {
          id: "flag:3",
          kind: "open-risk",
          label: "src/b.ts",
          targetId: "chunk-b",
        },
      ],
    });

    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(["Open risks 2", "Draft comments 2"]);
    const risks = screen.getByRole("list", { name: "Open risks 2" });
    expect(within(risks).getAllByRole("button")).toHaveLength(2);
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
      screen.getByRole("button", {
        name: /unread unattributed lines,\s?src\/orphan\.ts/i,
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /^submit review$/i }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(submitButton()).toBeTruthy();
  });

  it("sets a risk's attribute in its file name's size and colour", () => {
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
    const css = compileStylesheet(ROW_STYLESHEET);
    const rules = scopeCompiledRules(parseCompiledRules(css), rowStyles);

    const row = screen.getByRole("button", { name: /open risk/i });
    const attribute = within(row).getByText("Hot path");
    const fileName = within(row).getByText("a.ts");
    const directory = within(row).getByText("src/");

    for (const property of ["font-size", "color"]) {
      expect(resolveInheritedDeclaration(attribute, rules, property)).toBe(
        resolveInheritedDeclaration(fileName, rules, property),
      );
    }
    expect(resolveInheritedDeclaration(attribute, rules, "font-family")).toBe(
      "var(--font-sans)",
    );
    expect(resolveInheritedDeclaration(fileName, rules, "font-family")).toBe(
      "var(--font-mono)",
    );
    expect(resolveInheritedDeclaration(directory, rules, "color")).toBe(
      "var(--color-text-2)",
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
