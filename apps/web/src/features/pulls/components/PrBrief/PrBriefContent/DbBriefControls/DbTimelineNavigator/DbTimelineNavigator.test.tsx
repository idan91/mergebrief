// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DbTimelineNavigator } from "./DbTimelineNavigator";
import type { DbTimelinePoint } from "../../../../../utils/dbTimeline";

afterEach(cleanup);

/** Runtime-narrow an element to a button (repo rule: no bare `as`). */
function button(el: HTMLElement): HTMLButtonElement {
  if (!(el instanceof HTMLButtonElement)) {
    throw new Error("expected a button element");
  }
  return el;
}

function point(overrides: Partial<DbTimelinePoint>): DbTimelinePoint {
  return {
    headSha: "head",
    baseSha: "base",
    headIndex: 1,
    comparisons: {},
    ...overrides,
  };
}

const POINTS: DbTimelinePoint[] = [
  point({ headSha: "h1", headIndex: 1 }),
  point({
    headSha: "h2",
    headIndex: 2,
    comparisons: {
      previousBrief: {
        baselineSha: "h1",
        baselineIndex: 1,
        narrativeAvailable: true,
      },
    },
  }),
  point({ headSha: "h3", headIndex: 3 }),
];

function renderNav(
  selectedIndex: number,
  points: DbTimelinePoint[] = POINTS,
  onSelect = vi.fn(),
): { onSelect: ReturnType<typeof vi.fn> } {
  render(
    <DbTimelineNavigator
      next={points[selectedIndex + 1]}
      onSelect={onSelect}
      points={points}
      previous={points[selectedIndex - 1]}
      selectedIndex={selectedIndex}
    />,
  );
  return { onSelect };
}

describe("DbTimelineNavigator", () => {
  it("renders nothing for a single-revision PR", () => {
    const { container } = render(
      <DbTimelineNavigator
        next={undefined}
        onSelect={vi.fn()}
        points={[POINTS[0]!]}
        previous={undefined}
        selectedIndex={0}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("lists every revision in the picker and selects the current one by position", () => {
    renderNav(1);
    const select =
      screen.getByLabelText<HTMLSelectElement>("Select PR revision");
    expect(select.value).toBe("1");
    expect(
      screen.getByRole("option", { name: /Revision 1 of 3 · h1/ }),
    ).toBeDefined();
    expect(
      screen.getByRole("option", { name: /Revision 3 of 3 · h3/ }),
    ).toBeDefined();
  });

  it("marks Prev unavailable on the first revision and Next on the latest, keeping descriptive names and focus", () => {
    renderNav(0);
    // Unavailable arrows keep their name AND stay focusable: a hard
    // `disabled` drops focus at the ends.
    const prev = button(
      screen.getByRole("button", { name: "Previous revision (none)" }),
    );
    expect(prev.getAttribute("aria-disabled")).toBe("true");
    expect(prev.disabled).toBe(false);
    prev.focus();
    expect(document.activeElement).toBe(prev);
    const next = button(screen.getByLabelText("Next revision, 2"));
    expect(next.getAttribute("aria-disabled")).toBeNull();

    cleanup();
    renderNav(2);
    const nextAtLatest = button(
      screen.getByRole("button", { name: "Next revision (none)" }),
    );
    expect(nextAtLatest.getAttribute("aria-disabled")).toBe("true");
  });

  it("does nothing when an unavailable arrow is activated", () => {
    const { onSelect } = renderNav(0);
    fireEvent.click(
      screen.getByRole("button", { name: "Previous revision (none)" }),
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("steps revisions with Left/Right from ANY control in the navigator", () => {
    const { onSelect } = renderNav(1);
    // Binding the contract to the dots alone left the arrows dead.
    fireEvent.keyDown(screen.getByLabelText("Previous revision, 1"), {
      key: "ArrowLeft",
    });
    expect(onSelect).toHaveBeenLastCalledWith(POINTS[0]);
    fireEvent.keyDown(screen.getByLabelText("Select PR revision"), {
      key: "ArrowRight",
    });
    expect(onSelect).toHaveBeenLastCalledWith(POINTS[2]);
  });

  it("jumps to the first/last revision with Home/End", () => {
    const { onSelect } = renderNav(1);
    const nav = screen.getByLabelText("Next revision, 3");
    fireEvent.keyDown(nav, { key: "Home" });
    expect(onSelect).toHaveBeenLastCalledWith(POINTS[0]);
    fireEvent.keyDown(nav, { key: "End" });
    expect(onSelect).toHaveBeenLastCalledWith(POINTS[2]);
  });

  it("does not step past either end, and never re-selects the current point", () => {
    const first = renderNav(0);
    fireEvent.keyDown(screen.getByLabelText("Next revision, 2"), {
      key: "ArrowLeft",
    });
    expect(first.onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText("Next revision, 2"), {
      key: "Home",
    });
    expect(first.onSelect).not.toHaveBeenCalled();
    cleanup();
    const last = renderNav(2);
    fireEvent.keyDown(screen.getByLabelText("Previous revision, 2"), {
      key: "ArrowRight",
    });
    expect(last.onSelect).not.toHaveBeenCalled();
  });

  it("steps from the picker too, without shadowing its Up/Down", () => {
    const { onSelect } = renderNav(1);
    const picker = screen.getByLabelText("Select PR revision");
    fireEvent.keyDown(picker, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith(POINTS[2]);
    fireEvent.keyDown(picker, { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenLastCalledWith(POINTS[0]);
    // Up/Down stay native: the select walks its own options.
    onSelect.mockClear();
    fireEvent.keyDown(picker, { key: "ArrowDown" });
    fireEvent.keyDown(picker, { key: "ArrowUp" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("navigates to the previous/next revision point on arrow click", () => {
    const { onSelect } = renderNav(1);
    fireEvent.click(screen.getByLabelText("Previous revision, 1"));
    expect(onSelect).toHaveBeenCalledWith(POINTS[0]);
    fireEvent.click(screen.getByLabelText("Next revision, 3"));
    expect(onSelect).toHaveBeenCalledWith(POINTS[2]);
  });

  it("navigates on picker change by position", () => {
    const { onSelect } = renderNav(2);
    fireEvent.change(screen.getByLabelText("Select PR revision"), {
      target: { value: "0" },
    });
    expect(onSelect).toHaveBeenCalledWith(POINTS[0]);
  });

  it("addresses duplicate-head revisions as distinct points (retarget re-brief)", () => {
    const duplicates: DbTimelinePoint[] = [
      point({ headSha: "h1", baseSha: "b1", headIndex: 1 }),
      point({ headSha: "h2", baseSha: "b-old", headIndex: 2 }),
      point({ headSha: "h2", baseSha: "b-new", headIndex: 3 }),
    ];
    const { onSelect } = renderNav(2, duplicates);
    // Both duplicates are listed, disambiguated by their base.
    const options = screen.getAllByRole("option", { name: /Revision [23]/ });
    expect(options).toHaveLength(2);
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("(base b-old"),
      expect.stringContaining("(base b-new"),
    ]);
    // Selecting the OLDER duplicate emits that exact point, not the first
    // head match.
    fireEvent.change(screen.getByLabelText("Select PR revision"), {
      target: { value: "1" },
    });
    expect(onSelect).toHaveBeenCalledWith(duplicates[1]);
  });
});
