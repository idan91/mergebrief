// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  RevisionRow,
  RevisionTimelinePlan,
} from "../../../../../../model/types";
import { Revisions } from ".";

const ROWS: RevisionRow[] = [
  {
    key: "3",
    ordinal: 3,
    shortSha: "a81f3c2",
    at: "2026-09-29T12:00:00Z",
    current: false,
    newest: true,
  },
  { key: "2", ordinal: 2, shortSha: "5d0e91b", current: true, newest: false },
  { key: "1", ordinal: 1, shortSha: "9e21f4d", current: false, newest: false },
];

function renderRevisions(rows: RevisionRow[] = ROWS) {
  const plan: RevisionTimelinePlan = {
    view: { rows },
    selectRevision: vi.fn(),
  };
  const afterActivate = vi.fn();
  render(<Revisions afterActivate={afterActivate} plan={plan} />);
  return { plan, afterActivate };
}

function rowButtons(): HTMLElement[] {
  return screen.getAllByRole("button");
}

describe("Revisions", () => {
  it("lists the rows in the order given, newest first", () => {
    renderRevisions();
    const names = rowButtons().map((button) => button.textContent);
    expect(names[0]).toContain("Revision 3");
    expect(names[2]).toContain("Revision 1");
  });

  it("marks the current row with aria-current and names the newest", () => {
    renderRevisions();
    const [newest, current, oldest] = rowButtons();
    expect(current?.getAttribute("aria-current")).toBe("true");
    expect(newest?.hasAttribute("aria-current")).toBe(false);
    expect(newest?.textContent).toContain("Latest");
    expect(oldest?.textContent).not.toContain("Latest");
  });

  it("shows the short sha and a date only where the row has one", () => {
    renderRevisions();
    const [newest, current] = rowButtons();
    expect(newest?.textContent).toContain("a81f3c2");
    expect(newest?.textContent).toMatch(/2026/);
    expect(current?.textContent).not.toMatch(/2026/);
  });

  it("keeps the spine glyph out of the accessibility tree", () => {
    renderRevisions();
    for (const button of rowButtons()) {
      expect(button.firstElementChild?.getAttribute("aria-hidden")).toBe(
        "true",
      );
    }
  });

  it("selects another revision by key, then runs the after hook", () => {
    const { plan, afterActivate } = renderRevisions();
    fireEvent.click(screen.getByRole("button", { name: /Revision 1/ }));
    expect(plan.selectRevision).toHaveBeenCalledWith("1");
    expect(afterActivate).toHaveBeenCalledOnce();
  });

  it("does not reselect the current revision", () => {
    const { plan, afterActivate } = renderRevisions();
    fireEvent.click(screen.getByRole("button", { name: /Revision 2/ }));
    expect(plan.selectRevision).not.toHaveBeenCalled();
    expect(afterActivate).toHaveBeenCalledOnce();
  });
});
