// @vitest-environment jsdom
// The mark-ready soft gate: a transient, non-blocking modal listing ALL risk
// flags on the current head's Brief (no read-tracking filter), plus the
// unposted-drafts reminder when any exist. "Mark ready anyway" is one click
// and records nothing. The zero-flag bypass (modal skipped entirely) is the
// CALLER's contract, pinned in ownDraftView.test.tsx.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RiskFlag } from "@web/features/brief/utils";
import { MarkReadyModal } from "./MarkReadyModal";

afterEach(cleanup);

const FLAGS: RiskFlag[] = [
  {
    id: "flag-1",
    attr: "no-tests",
    file: "src/a.ts",
    chunkId: "chunk-a",
    groupId: "g1",
    description: "no-tests @ src/a.ts",
    source: "built-in",
    deEmphasized: false,
  },
  {
    id: "flag-2",
    attr: "touches-auth",
    file: "src/b.ts",
    chunkId: "chunk-b",
    groupId: "g1",
    description: "touches-auth @ src/b.ts",
    source: "built-in",
    deEmphasized: false,
  },
];

function renderModal(
  overrides: Partial<Parameters<typeof MarkReadyModal>[0]> = {},
) {
  const close = vi.fn();
  const markReadyAnyway = vi.fn();
  const jumpToFlag = vi.fn();
  const jumpToDrafts = vi.fn();
  render(
    <MarkReadyModal
      open
      flags={FLAGS}
      unpostedDraftCount={0}
      close={close}
      markReadyAnyway={markReadyAnyway}
      jumpToFlag={jumpToFlag}
      jumpToDrafts={jumpToDrafts}
      {...overrides}
    />,
  );
  return { close, markReadyAnyway, jumpToFlag, jumpToDrafts };
}

describe("MarkReadyModal", () => {
  it("lists every flag (no read-tracking filter) and jumps on click", () => {
    const { jumpToFlag } = renderModal();
    expect(screen.getByText("src/a.ts")).toBeTruthy();
    expect(screen.getByText("src/b.ts")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /touches-auth/ }));
    expect(jumpToFlag).toHaveBeenCalledWith(FLAGS[1]);
  });

  it("marks ready anyway with ONE click", () => {
    const { markReadyAnyway, close } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Mark ready anyway" }));
    expect(markReadyAnyway).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(0);
  });

  it("stays non-blocking: Keep self-reviewing closes without acting", () => {
    const { markReadyAnyway, close } = renderModal();
    fireEvent.click(
      screen.getByRole("button", { name: "Keep self-reviewing" }),
    );
    expect(close).toHaveBeenCalledTimes(1);
    expect(markReadyAnyway).toHaveBeenCalledTimes(0);
  });

  it("shows the unposted-drafts reminder with a jump link when N>0", () => {
    const { jumpToDrafts } = renderModal({ unpostedDraftCount: 3 });
    expect(
      screen.getByText("You have 3 unposted draft comments."),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /jump to your drafts/i }),
    );
    expect(jumpToDrafts).toHaveBeenCalledTimes(1);
    // The opt-in is a checkbox, never a one-click post button.
    expect(screen.queryByRole("button", { name: /^post/i })).toBeNull();
  });

  it("offers the post-my-drafts checkbox (default UNCHECKED) only when N>0", () => {
    renderModal({ unpostedDraftCount: 3, postDrafts: false });
    const checkbox = screen.getByRole("checkbox", {
      name: /post my 3 draft comments before marking ready/i,
    }) as HTMLInputElement;
    // Default unchecked — posting is an outward write.
    expect(checkbox.checked).toBe(false);
  });

  it("toggles the checkbox through setPostDrafts", () => {
    const setPostDrafts = vi.fn();
    renderModal({ unpostedDraftCount: 2, postDrafts: false, setPostDrafts });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /post my 2 draft comments/i }),
    );
    expect(setPostDrafts).toHaveBeenCalledWith(true);
  });

  it("hides the reminder AND the checkbox entirely at zero drafts", () => {
    renderModal({ unpostedDraftCount: 1 });
    expect(screen.getByText("You have 1 unposted draft comment.")).toBeTruthy();
    cleanup();
    renderModal({ unpostedDraftCount: 0 });
    expect(screen.queryByText(/unposted draft comment/)).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("renders coherently with zero flags: drafts advisory, no risk-flag copy or empty list", () => {
    // The gate can open for unposted drafts alone: the risk-flag advisory
    // and jump list must not render over an empty flag set — the copy focuses
    // on the drafts instead.
    renderModal({ flags: [], unpostedDraftCount: 2 });
    expect(screen.queryByText(/these risk flags/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /no-tests/ })).toBeNull();
    expect(
      screen.getByText(/your unposted draft comments stay local/i),
    ).toBeTruthy();
    expect(
      screen.getByText("You have 2 unposted draft comments."),
    ).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: /post my 2 draft comments/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Mark ready anyway" }),
    ).toBeTruthy();
  });

  it("Escape closes when idle but is a no-op while the batch runs", () => {
    // Mid-batch the close handler is withheld from the Modal (absent close =
    // Escape no-op), matching the disabled controls.
    const idle = renderModal({ unpostedDraftCount: 2 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(idle.close).toHaveBeenCalledTimes(1);
    cleanup();

    const busy = renderModal({
      unpostedDraftCount: 2,
      postDrafts: true,
      busyLabel: "Posting 1 of 2…",
    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(busy.close).toHaveBeenCalledTimes(0);
  });

  it("shows batch progress on the confirm button and disables every control", () => {
    const { markReadyAnyway, close, jumpToDrafts } = renderModal({
      unpostedDraftCount: 3,
      postDrafts: true,
      busyLabel: "Posting 2 of 3…",
    });
    // The confirm is aria-disabled + aria-busy, never hard disabled — a
    // disabled element would dump keyboard focus on <body> inside the modal's
    // trap. The click stays a no-op via the busy guard.
    const confirm = screen.getByRole("button", {
      name: "Posting 2 of 3…",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(confirm);
    expect(markReadyAnyway).toHaveBeenCalledTimes(0);
    // Nothing that could start a second batch is live.
    expect(
      (
        screen.getByRole("button", {
          name: "Keep self-reviewing",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: /jump to your drafts/i,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("checkbox", {
          name: /post my 3 draft comments/i,
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    void close;
    void jumpToDrafts;
  });

  it("announces batch progress through a polite live region inside the modal", () => {
    // The confirm button's visual relabel is silent to screen readers — the
    // progress text must also flow through a status live region.
    renderModal({
      unpostedDraftCount: 3,
      postDrafts: true,
      busyLabel: "Posting 2 of 3…",
    });
    const region = screen
      .getAllByRole("status")
      .find((el) => el.getAttribute("aria-live") === "polite");
    expect(region?.textContent).toBe("Posting 2 of 3…");

    cleanup();
    // Idle: the region is present but empty — nothing to announce.
    renderModal({ unpostedDraftCount: 3 });
    const idleRegion = screen
      .getAllByRole("status")
      .find((el) => el.getAttribute("aria-live") === "polite");
    expect(idleRegion?.textContent).toBe("");
  });

  it("aria-disabled confirm still acts when idle (no hard-disable regression)", () => {
    const { markReadyAnyway } = renderModal({ unpostedDraftCount: 2 });
    const confirm = screen.getByRole("button", { name: "Mark ready anyway" });
    expect(confirm.getAttribute("aria-disabled")).toBe("false");
    fireEvent.click(confirm);
    expect(markReadyAnyway).toHaveBeenCalledTimes(1);
  });

  // The count-only intent line.
  const intentLine = /stated ask.* not found in the diff/;

  it("shows no intent line when there are no missing asks (absence, not a verdict)", () => {
    renderModal();
    expect(screen.queryByText(intentLine)).toBeNull();
    cleanup();
    renderModal({ intentGapCount: 0 });
    expect(screen.queryByText(intentLine)).toBeNull();
  });

  it("renders one count-only line (plural) when precise asks are missing", () => {
    renderModal({ intentGapCount: 3 });
    expect(
      screen.getByText("3 stated asks not found in the diff"),
    ).toBeTruthy();
  });

  it("uses the singular for exactly one missing ask", () => {
    renderModal({ intentGapCount: 1 });
    expect(screen.getByText("1 stated ask not found in the diff")).toBeTruthy();
  });

  it("closes the modal and jumps to the expanded intent bar on click", () => {
    const jumpToIntentGaps = vi.fn();
    renderModal({ intentGapCount: 2, jumpToIntentGaps });
    fireEvent.click(screen.getByText("2 stated asks not found in the diff"));
    expect(jumpToIntentGaps).toHaveBeenCalledTimes(1);
  });

  it("disables the intent line while a draft batch is running", () => {
    const jumpToIntentGaps = vi.fn();
    renderModal({
      intentGapCount: 2,
      jumpToIntentGaps,
      unpostedDraftCount: 3,
      busyLabel: "Posting 1 of 3…",
    });
    const line = screen.getByText("2 stated asks not found in the diff");
    expect(line).toHaveProperty("disabled", true);
    fireEvent.click(line);
    expect(jumpToIntentGaps).toHaveBeenCalledTimes(0);
  });

  // The second count-only line: intent tensions.
  const tensionLine = /intent tension.* flagged/;

  it("shows no tension line when there are none (absence, not a green verdict)", () => {
    renderModal();
    expect(screen.queryByText(tensionLine)).toBeNull();
    cleanup();
    renderModal({ intentTensionCount: 0 });
    expect(screen.queryByText(tensionLine)).toBeNull();
  });

  it("renders one count-only tension line, plural and singular", () => {
    renderModal({ intentTensionCount: 2 });
    expect(screen.getByText("2 intent tensions flagged")).toBeTruthy();
    cleanup();
    renderModal({ intentTensionCount: 1 });
    expect(screen.getByText("1 intent tension flagged")).toBeTruthy();
  });

  it("names nothing — the line is a count, never the tension itself", () => {
    renderModal({ intentTensionCount: 3 });
    const line = screen.getByText("3 intent tensions flagged");
    // Anchoring the author on the shakiest inference in the Brief, at the
    // moment they are deciding to ship, is exactly what the count-only
    // affordance exists to avoid.
    expect(line.textContent).toBe("3 intent tensions flagged");
  });

  it("shares the gap line's jump target and sits alongside it, not instead of it", () => {
    const jumpToIntentGaps = vi.fn();
    renderModal({ intentGapCount: 2, intentTensionCount: 1, jumpToIntentGaps });
    // Both lines render; neither suppresses the other.
    expect(
      screen.getByText("2 stated asks not found in the diff"),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("1 intent tension flagged"));
    expect(jumpToIntentGaps).toHaveBeenCalledTimes(1);
  });

  it("disables the tension line while a draft batch is running", () => {
    const jumpToIntentGaps = vi.fn();
    renderModal({
      intentTensionCount: 2,
      jumpToIntentGaps,
      unpostedDraftCount: 3,
      busyLabel: "Posting 1 of 3…",
    });
    const line = screen.getByText("2 intent tensions flagged");
    expect(line).toHaveProperty("disabled", true);
    fireEvent.click(line);
    expect(jumpToIntentGaps).toHaveBeenCalledTimes(0);
  });

  it("never blocks the gate — confirm stays available with tensions flagged", () => {
    const markReadyAnyway = vi.fn();
    renderModal({ intentTensionCount: 4, markReadyAnyway });
    const confirm = screen.getByRole("button", { name: /mark ready/i });
    expect(confirm).toHaveProperty("disabled", false);
    fireEvent.click(confirm);
    expect(markReadyAnyway).toHaveBeenCalledTimes(1);
  });
});
