// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DbTimelineNavigator } from "./DbTimelineNavigator";
import type { DbTimelinePoint } from "../../../dbTimeline";

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
      screen.getByRole("option", { name: /Revision 1 · h1/ }),
    ).toBeDefined();
    expect(
      screen.getByRole("option", { name: /Revision 3 · h3/ }),
    ).toBeDefined();
  });

  it("disables Prev on the first revision and Next on the latest, keeping descriptive names", () => {
    renderNav(0);
    // Disabled arrows KEEP an accessible name — a bare glyph reads as
    // nothing to a screen reader (codex round 1).
    const prev = button(
      screen.getByRole("button", { name: "Previous revision (none)" }),
    );
    expect(prev.disabled).toBe(true);
    const next = button(screen.getByLabelText("Next revision, 2"));
    expect(next.disabled).toBe(false);

    cleanup();
    renderNav(2);
    const nextAtLatest = button(
      screen.getByRole("button", { name: "Next revision (none)" }),
    );
    expect(nextAtLatest.disabled).toBe(true);
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

  it("marks the selected step with aria-current and comparable points", () => {
    renderNav(1);
    const current = screen.getByRole("button", { current: "step" });
    expect(current.querySelector(".sr-only")?.textContent).toContain(
      "Revision 2",
    );
  });
});
