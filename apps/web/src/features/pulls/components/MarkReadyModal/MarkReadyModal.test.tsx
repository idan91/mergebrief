// @vitest-environment jsdom
// The mark-ready soft gate (BRIEF-43, ADR 0009 #3, ADR 0031): a transient,
// non-blocking modal listing ALL risk flags on the current head's Brief (no
// read-tracking filter), plus the unposted-drafts reminder when any exist.
// "Mark ready anyway" is one click and records nothing. The zero-flag bypass
// (modal skipped entirely) is the CALLER's contract, pinned in
// ownDraftView.test.tsx.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RiskFlag } from "../../../brief/viewModel";
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
  },
  {
    id: "flag-2",
    attr: "touches-auth",
    file: "src/b.ts",
    chunkId: "chunk-b",
    groupId: "g1",
    description: "touches-auth @ src/b.ts",
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

  it("shows the unposted-drafts reminder with a jump link (no auto-post) when N>0", () => {
    const { jumpToDrafts } = renderModal({ unpostedDraftCount: 3 });
    expect(
      screen.getByText("You have 3 unposted draft comments."),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /jump to your drafts/i }),
    );
    expect(jumpToDrafts).toHaveBeenCalledTimes(1);
    // No post affordance anywhere near the reminder.
    expect(screen.queryByRole("button", { name: /post/i })).toBeNull();
  });

  it("singularizes the reminder and hides it entirely at zero drafts", () => {
    renderModal({ unpostedDraftCount: 1 });
    expect(screen.getByText("You have 1 unposted draft comment.")).toBeTruthy();
    cleanup();
    renderModal({ unpostedDraftCount: 0 });
    expect(screen.queryByText(/unposted draft comment/)).toBeNull();
  });
});
