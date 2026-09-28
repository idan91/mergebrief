// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InboxReviewStates } from "types/inbox";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InboxItem } from "../../../types";
import { PurgeAttachmentsModal } from ".";

afterEach(cleanup);

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    repoId: "424242",
    repoSlug: "acme/payments",
    prNumber: 7,
    title: "Retry failed webhook deliveries",
    state: "open",
    draft: false,
    source: "installation",
    installationId: "10",
    viewerIsAuthor: false,
    viewerCanDelete: true,
    reviewState: InboxReviewStates.NEW,
    behind: false,
    unreachable: false,
    generation: null,
    latestBriefAt: null,
    githubUpdatedAt: null,
    stack: null,
    ...overrides,
  };
}

function renderModal(
  overrides: Partial<Parameters<typeof PurgeAttachmentsModal>[0]> = {},
) {
  const cancel = vi.fn();
  const confirm = vi.fn();
  render(
    <PurgeAttachmentsModal
      busy={false}
      item={makeItem()}
      cancel={cancel}
      confirm={confirm}
      {...overrides}
    />,
  );
  return { cancel, confirm };
}

function readConfirm(): HTMLElement {
  return screen.getByRole("button", { name: "Delete branch" });
}

describe("PurgeAttachmentsModal", () => {
  it("opens with focus on Cancel and names the repository in the heading", () => {
    renderModal();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Delete the attachment branch of acme/payments?",
      }),
    ).toBeDefined();
    expect(screen.getByRole("dialog").textContent).toContain(
      "breaks those images in every comment",
    );
  });

  it("holds Delete until the typed name matches the repository", () => {
    const { confirm } = renderModal();
    const input = screen.getByLabelText("Type acme/payments to confirm");

    expect(readConfirm().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(readConfirm());
    expect(confirm).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "acme/payment" } });
    expect(readConfirm().getAttribute("aria-disabled")).toBe("true");

    fireEvent.change(input, { target: { value: "acme/payments" } });
    expect(readConfirm().getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(readConfirm());
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("Enter in the field confirms only once the name matches", () => {
    const { confirm } = renderModal();
    const input = screen.getByLabelText("Type acme/payments to confirm");

    fireEvent.submit(input);
    expect(confirm).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: " acme/payments " } });
    fireEvent.submit(input);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("Escape and Cancel cancel unless a delete is in flight", () => {
    const { cancel } = renderModal();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledTimes(2);

    cleanup();
    const busy = renderModal({ busy: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(busy.cancel).not.toHaveBeenCalled();
  });

  it("while busy both buttons are inert and Delete reads as busy", () => {
    renderModal({ busy: true });

    const confirm = screen.getByRole("button", { name: "Deleting" });
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Cancel" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });
});
