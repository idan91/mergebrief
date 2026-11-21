// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InboxEmptinesses } from "../../types";
import { EmptyInbox } from ".";

describe("EmptyInbox", () => {
  it("filtered to nothing explains the default status and clears", () => {
    const onClear = vi.fn();
    render(
      <EmptyInbox
        archivedTotal={0}
        defaultStatus
        reason={InboxEmptinesses.FILTERED}
        onClear={onClear}
        onShowArchived={vi.fn()}
        onShowAll={vi.fn()}
        onShowHidden={vi.fn()}
        onShowInbox={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "No pull requests match these filters",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/hidden by default/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("nothing open and no filter set offers the hidden rows, not Clear", () => {
    const onShowHidden = vi.fn();
    render(
      <EmptyInbox
        archivedTotal={0}
        defaultStatus
        reason={InboxEmptinesses.HIDDEN_BY_DEFAULT}
        onClear={vi.fn()}
        onShowArchived={vi.fn()}
        onShowAll={vi.fn()}
        onShowHidden={onShowHidden}
        onShowInbox={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "No open pull requests" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Show merged and closed" }),
    );
    expect(onShowHidden).toHaveBeenCalledTimes(1);
  });

  it("leaves the default-status line out once Status is changed", () => {
    render(
      <EmptyInbox
        archivedTotal={0}
        defaultStatus={false}
        reason={InboxEmptinesses.FILTERED}
        onClear={vi.fn()}
        onShowArchived={vi.fn()}
        onShowAll={vi.fn()}
        onShowHidden={vi.fn()}
        onShowInbox={vi.fn()}
      />,
    );

    expect(screen.queryByText(/hidden by default/)).toBeNull();
  });

  it("an empty held view says nothing is held and offers every row", () => {
    const onShowAll = vi.fn();
    render(
      <EmptyInbox
        archivedTotal={0}
        defaultStatus
        reason={InboxEmptinesses.HELD_ONLY}
        onClear={vi.fn()}
        onShowAll={onShowAll}
        onShowArchived={vi.fn()}
        onShowHidden={vi.fn()}
        onShowInbox={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "No held pull requests" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });

  it("an empty archived view offers the way back to the Inbox", () => {
    const onShowInbox = vi.fn();
    render(
      <EmptyInbox
        archivedTotal={0}
        defaultStatus
        reason={InboxEmptinesses.ARCHIVED_ONLY}
        onClear={vi.fn()}
        onShowArchived={vi.fn()}
        onShowAll={vi.fn()}
        onShowHidden={vi.fn()}
        onShowInbox={onShowInbox}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "No archived pull requests" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to Inbox" }));
    expect(onShowInbox).toHaveBeenCalledTimes(1);
  });

  it("everything archived names the count and opens the archived view", () => {
    const onShowArchived = vi.fn();
    render(
      <EmptyInbox
        archivedTotal={3}
        defaultStatus
        reason={InboxEmptinesses.ALL_ARCHIVED}
        onClear={vi.fn()}
        onShowArchived={onShowArchived}
        onShowAll={vi.fn()}
        onShowHidden={vi.fn()}
        onShowInbox={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "3 pull requests are archived" }),
    ).toBeTruthy();
    expect(screen.getByText(/new brief lands/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show archived" }));
    expect(onShowArchived).toHaveBeenCalledTimes(1);
  });
});
