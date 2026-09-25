// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InboxReviewStates } from "types/inbox";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InboxItem } from "../../../types";
import { DeleteModal } from "./DeleteModal";

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

  it("names one row in the heading and the cascade in the body", () => {
    renderModal();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Delete briefs for #7 acme/payments?",
      }),
    ).toBeDefined();
    expect(screen.getByRole("dialog").textContent).toContain(
      "cannot be undone",
    );
    expect(screen.getByRole("dialog").textContent).toContain(
      "review session, draft comments and flag decisions",
    );
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("lists several rows under a counted heading", () => {
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
    const rows = screen.getAllByRole("listitem").map((row) => row.textContent);
    expect(rows).toEqual([
      "#7 acme/payments: Retry failed webhook deliveries",
      "#8 acme/payments: Second",
      "#9 acme/billing: Third",
    ]);
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
