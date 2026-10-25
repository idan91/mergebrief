// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InboxReviewStates } from "types/inbox";
import { describe, expect, it, vi } from "vitest";

import type { InboxItem } from "../../../types";
import { DeleteModal } from ".";

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
    ...overrides,
  };
}

function renderModal(
  overrides: Partial<Parameters<typeof DeleteModal>[0]> = {},
) {
  const cancel = vi.fn();
  const confirm = vi.fn();
  render(
    <DeleteModal
      open
      busy={false}
      items={[makeItem()]}
      cancel={cancel}
      confirm={confirm}
      {...overrides}
    />,
  );
  return { cancel, confirm };
}

describe("DeleteModal", () => {
  it("opens with focus on Cancel, the safe default", () => {
    renderModal();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
  });

  it("names one row in the heading and the cascade in three paragraphs", () => {
    renderModal();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Delete briefs for #7 acme/payments?",
      }),
    ).toBeDefined();
    const paragraphs = screen
      .getAllByText(/./, { selector: "p" })
      .map((node) => node.textContent);
    expect(paragraphs).toEqual([
      "Every brief for this pull request goes, and with it every reviewer's review session, draft comments and flag decisions.",
      "This cannot be undone.",
      "The next push is briefed as usual; the comment on GitHub stays.",
    ]);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("counts several rows in the heading and lists none of them", () => {
    renderModal({
      items: [
        makeItem(),
        makeItem({ prNumber: 8, title: "Second" }),
        makeItem({ prNumber: 9, title: "Third", repoSlug: "acme/billing" }),
      ],
    });

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Delete briefs for 3 pull requests?",
      }),
    ).toBeDefined();
    expect(screen.getByRole("dialog").textContent).toContain(
      "these pull requests",
    );
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText("Second")).toBeNull();
  });

  it("Confirm calls confirm and Cancel calls cancel", () => {
    const { cancel, confirm } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("Escape cancels unless a delete is in flight", () => {
    const { cancel } = renderModal();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(cancel).toHaveBeenCalledTimes(1);

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
