// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { InboxArchivedFilters } from "types/inbox";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SelectionHeader, type SelectionHeaderProps } from "./SelectionHeader";

afterEach(cleanup);

function renderHeader(overrides: Partial<SelectionHeaderProps> = {}) {
  const handlers = {
    onSelectPage: vi.fn(),
    onSelectAllMatching: vi.fn(),
    onClearAllMatching: vi.fn(),
    onArchive: vi.fn(),
    onDelete: vi.fn(),
    onClear: vi.fn(),
  };
  render(
    <SelectionHeader
      allMatching={false}
      allSelected={false}
      archived={InboxArchivedFilters.HIDE}
      busy={false}
      cap={200}
      deletableCount={0}
      pageCount={12}
      selectedCount={0}
      someSelected={false}
      total={37}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe("SelectionHeader", () => {
  it("hints at zero and offers no action", () => {
    renderHeader();
    expect(
      screen.getByText("12 of 37 · tick rows to act on them together"),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(
      screen
        .getByRole("checkbox", { name: "Select all on this page" })
        .getAttribute("aria-checked"),
    ).toBeNull();
  });

  it("counts the ticks, the undeletable ones, and offers the three actions", () => {
    const { onArchive, onDelete, onClear } = renderHeader({
      selectedCount: 3,
      deletableCount: 2,
      someSelected: true,
    });

    expect(screen.getByText("3 selected")).toBeTruthy();
    expect(screen.getByText("1 cannot be deleted")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Archive 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole("checkbox", { name: "Select all on this page" })
        .getAttribute("aria-checked"),
    ).toBe("mixed");
  });

  it("offers every matching row once the page is ticked and more exist", () => {
    const { onSelectAllMatching } = renderHeader({
      selectedCount: 12,
      deletableCount: 12,
      allSelected: true,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Select all 37 matching" }),
    );
    expect(onSelectAllMatching).toHaveBeenCalledTimes(1);
  });

  it("names the cap when the matching rows outnumber it", () => {
    renderHeader({
      selectedCount: 12,
      deletableCount: 12,
      allSelected: true,
      total: 437,
    });
    expect(
      screen.getByRole("button", {
        name: "Select the first 200 of 437 matching",
      }),
    ).toBeTruthy();
  });

  it("reads the whole match once chosen, with the way back to the page", () => {
    const { onClearAllMatching } = renderHeader({
      selectedCount: 12,
      deletableCount: 12,
      allSelected: true,
      allMatching: true,
    });

    expect(screen.getByText("All 37 matching selected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive 37" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Delete matching" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Only this page" }));
    expect(onClearAllMatching).toHaveBeenCalledTimes(1);
  });

  it("holds Delete at zero deletable and every action while busy", () => {
    renderHeader({ selectedCount: 2, deletableCount: 0 });
    expect(
      screen
        .getByRole("button", { name: "Delete 0" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    cleanup();

    renderHeader({ selectedCount: 2, deletableCount: 2, busy: true });
    for (const name of ["Archive 2", "Delete 2", "Clear selection"]) {
      expect(
        screen.getByRole("button", { name }).getAttribute("aria-disabled"),
      ).toBe("true");
    }
  });

  it("holds the page checkbox and the matching links while busy", () => {
    const { onSelectAllMatching } = renderHeader({
      selectedCount: 12,
      deletableCount: 12,
      allSelected: true,
      busy: true,
    });
    const page = screen.getByRole("checkbox", {
      name: "Select all on this page",
    });
    expect(page.hasAttribute("disabled")).toBe(true);
    const link = screen.getByRole("button", {
      name: "Select all 37 matching",
    });
    expect(link.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(link);
    expect(onSelectAllMatching).not.toHaveBeenCalled();
    cleanup();

    const { onClearAllMatching } = renderHeader({
      selectedCount: 12,
      deletableCount: 12,
      allSelected: true,
      allMatching: true,
      busy: true,
    });
    const back = screen.getByRole("button", { name: "Only this page" });
    expect(back.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(back);
    expect(onClearAllMatching).not.toHaveBeenCalled();
  });

  it("focus follows the link swap between the match and the page", () => {
    function Stage() {
      const [allMatching, setAllMatching] = useState(false);
      return (
        <SelectionHeader
          allMatching={allMatching}
          allSelected
          archived={InboxArchivedFilters.HIDE}
          busy={false}
          cap={200}
          deletableCount={12}
          pageCount={12}
          selectedCount={12}
          someSelected={false}
          total={37}
          onArchive={vi.fn()}
          onClear={vi.fn()}
          onClearAllMatching={() => setAllMatching(false)}
          onDelete={vi.fn()}
          onSelectAllMatching={() => setAllMatching(true)}
          onSelectPage={vi.fn()}
        />
      );
    }
    render(<Stage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Select all 37 matching" }),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Only this page" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Only this page" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Select all 37 matching" }),
    );
  });

  it("reads Unarchive in the archived view", () => {
    renderHeader({
      archived: InboxArchivedFilters.ONLY,
      selectedCount: 2,
      deletableCount: 1,
    });
    expect(screen.getByRole("button", { name: "Unarchive 2" })).toBeTruthy();
  });
});
