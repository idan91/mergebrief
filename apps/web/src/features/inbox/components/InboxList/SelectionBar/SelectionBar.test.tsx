// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InboxArchivedFilters } from "types/inbox";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SelectionBar } from "./SelectionBar";

afterEach(cleanup);

function renderBar(
  overrides: Partial<Parameters<typeof SelectionBar>[0]> = {},
) {
  const onArchive = vi.fn();
  const onDelete = vi.fn();
  const onClear = vi.fn();
  render(
    <SelectionBar
      archived={InboxArchivedFilters.HIDE}
      busy={false}
      count={3}
      deletableCount={2}
      onArchive={onArchive}
      onClear={onClear}
      onDelete={onDelete}
      {...overrides}
    />,
  );
  return { onArchive, onDelete, onClear };
}

describe("SelectionBar", () => {
  it("renders nothing while nothing is selected", () => {
    renderBar({ count: 0, deletableCount: 0 });
    expect(screen.queryByText("0 selected")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("counts the selection politely and offers the three actions", () => {
    const { onArchive, onDelete, onClear } = renderBar();

    expect(screen.getByText("3 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Archive 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.getByText("1 cannot be deleted")).toBeTruthy();
  });

  it("Delete counts only the deletable rows and holds at zero", () => {
    const { onDelete } = renderBar({ count: 2, deletableCount: 0 });

    const remove = screen.getByRole("button", { name: "Delete 0" });
    expect(remove.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(remove);
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("2 cannot be deleted")).toBeTruthy();
  });

  it("reads Unarchive in the archived view", () => {
    renderBar({ archived: InboxArchivedFilters.ONLY });
    expect(screen.getByRole("button", { name: "Unarchive 3" })).toBeTruthy();
  });

  it("holds every action while a bulk action runs", () => {
    renderBar({ busy: true });
    for (const name of ["Archive 3", "Delete 2", "Clear selection"]) {
      expect(
        screen.getByRole("button", { name }).getAttribute("aria-disabled"),
      ).toBe("true");
    }
  });
});
