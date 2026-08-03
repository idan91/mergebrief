// @vitest-environment jsdom
// Stale-view submit ack (BRIEF-127): when the viewed span's head is no longer
// the PR head, Submit requires an explicit acknowledge — comments will anchor
// to the reviewed revision. The ack is drawer-local and resets on reopen.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Receipt } from "../../utils/receipt";
import { ReceiptDrawer, type ReceiptDrawerProps } from "./ReceiptDrawer";

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

function renderDrawer(overrides: Partial<ReceiptDrawerProps> = {}) {
  const submit = vi.fn();
  const view = render(
    <ReceiptDrawer
      receipt={receipt()}
      open
      close={vi.fn()}
      openSummaryPreview={vi.fn()}
      submit={submit}
      {...overrides}
    />,
  );
  return { view, submit };
}

const submitButton = () =>
  screen.getByRole("button", { name: /submit review to github/i });
const ackCheckbox = () =>
  screen.getByRole("checkbox", {
    name: /submit against the reviewed revision anyway/i,
  });

describe("ReceiptDrawer stale-head ack", () => {
  // No vitest globals in this repo → testing-library does not auto-cleanup.
  afterEach(cleanup);

  it("renders no ack UI and submits directly when the view is current", () => {
    const { submit } = renderDrawer();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/newer commits/i)).toBeNull();
    fireEvent.click(submitButton());
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("gates Submit behind the ack when the view is stale", () => {
    const { submit } = renderDrawer({ staleHead: true });
    expect(
      screen.getByText(/comments will anchor to the revision you reviewed/i),
    ).toBeTruthy();
    const button = submitButton();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    // The disabled control points at the warning so AT hears WHY it is off.
    expect(button.getAttribute("aria-describedby")).toBe(
      "receipt-stale-warning",
    );
    fireEvent.click(button);
    expect(submit).not.toHaveBeenCalled();
  });

  it("acknowledging re-enables Submit", () => {
    const { submit } = renderDrawer({ staleHead: true });
    fireEvent.click(ackCheckbox());
    const button = submitButton();
    expect(button.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(button);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("resets the ack when the drawer reopens", () => {
    const { view, submit } = renderDrawer({ staleHead: true });
    fireEvent.click(ackCheckbox());
    const props = {
      receipt: receipt(),
      close: vi.fn(),
      openSummaryPreview: vi.fn(),
      submit,
      staleHead: true,
    };
    view.rerender(<ReceiptDrawer {...props} open={false} />);
    view.rerender(<ReceiptDrawer {...props} open />);
    const box = ackCheckbox();
    expect(box).toHaveProperty("checked", false);
    fireEvent.click(submitButton());
    expect(submit).not.toHaveBeenCalled();
  });

  it("re-requires the ack when staleness returns while open", () => {
    const { view, submit } = renderDrawer({ staleHead: true });
    fireEvent.click(ackCheckbox());
    const props = {
      receipt: receipt(),
      close: vi.fn(),
      openSummaryPreview: vi.fn(),
      submit,
    };
    view.rerender(<ReceiptDrawer {...props} open staleHead={false} />);
    view.rerender(<ReceiptDrawer {...props} open staleHead />);
    expect(ackCheckbox()).toHaveProperty("checked", false);
    fireEvent.click(submitButton());
    expect(submit).not.toHaveBeenCalled();
  });

  it("clears the ack UI when staleness flips off while open", () => {
    const { view, submit } = renderDrawer({ staleHead: true });
    const props = {
      receipt: receipt(),
      close: vi.fn(),
      openSummaryPreview: vi.fn(),
      submit,
    };
    view.rerender(<ReceiptDrawer {...props} open staleHead={false} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(submitButton());
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("an external blocked reason keeps precedence over the stale ack", () => {
    const { submit } = renderDrawer({
      staleHead: true,
      submitBlockedReason: "A comment is still posting.",
    });
    fireEvent.click(ackCheckbox());
    const button = submitButton();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-describedby")).toBe(
      "receipt-submit-blocked",
    );
    fireEvent.click(button);
    expect(submit).not.toHaveBeenCalled();
  });
});
