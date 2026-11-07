// @vitest-environment jsdom
import { act, render, renderHook, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { InboxReviewStates } from "types/inbox";
import { describe, expect, it, onTestFinished } from "vitest";

import { Checkbox } from "@web/components/Checkbox";
import type { InboxItem } from "../../types";
import { useInboxSelection } from "./useInboxSelection";

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    repoId: "424242",
    repoSlug: "acme/payments",
    prNumber: 7,
    title: "t",
    state: "open",
    draft: false,
    source: "installation",
    installationId: "10",
    viewerIsAuthor: false,
    viewerCanDelete: false,
    reviewState: InboxReviewStates.NEW,
    behind: false,
    unreachable: false,
    ...overrides,
  };
}

const ROWS = [
  makeItem({ prNumber: 1 }),
  makeItem({ prNumber: 2, viewerCanDelete: true }),
  makeItem({ prNumber: 3 }),
];

describe("useInboxSelection", () => {
  it("sets rows by key and derives the page states", () => {
    const { result } = renderHook(() => useInboxSelection(ROWS));

    expect(result.current.selectedItems).toEqual([]);
    expect(result.current.someSelected).toBe(false);
    expect(result.current.allSelected).toBe(false);

    act(() => result.current.setSelected(ROWS[1]!, true));
    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      2,
    ]);
    expect(result.current.someSelected).toBe(true);
    expect(result.current.allSelected).toBe(false);

    act(() => result.current.setSelected(ROWS[1]!, false));
    expect(result.current.selectedItems).toEqual([]);
  });

  it("select page ticks every row; unticking it clears them", () => {
    const { result } = renderHook(() => useInboxSelection(ROWS));

    act(() => result.current.selectPage(true));
    expect(result.current.allSelected).toBe(true);
    expect(result.current.someSelected).toBe(false);
    expect(result.current.selectedItems).toHaveLength(3);

    act(() => result.current.selectPage(false));
    expect(result.current.selectedItems).toEqual([]);
  });

  it("keeps only the rows still on the page, by key, and clears on demand", () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: readonly InboxItem[] }) => useInboxSelection(items),
      { initialProps: { items: ROWS } },
    );
    act(() => result.current.selectPage(true));

    rerender({ items: ROWS.slice(1) });
    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      2, 3,
    ]);

    rerender({ items: ROWS.slice(1).map((row) => ({ ...row })) });
    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      2, 3,
    ]);

    act(() => result.current.clear());
    expect(result.current.selectedItems).toEqual([]);
  });

  it("a range gives the span the clicked row's new state", () => {
    const rows = [1, 2, 3, 4, 5].map((prNumber) => makeItem({ prNumber }));
    const { result } = renderHook(() => useInboxSelection(rows));

    act(() => result.current.setSelected(rows[1]!, true));
    act(() => result.current.setSelected(rows[3]!, true, true));
    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      2, 3, 4,
    ]);

    act(() => result.current.setSelected(rows[0]!, true, true));
    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      1, 2, 3, 4,
    ]);

    act(() => result.current.setSelected(rows[2]!, false));
    act(() => result.current.setSelected(rows[4]!, true, true));
    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      1, 2, 3, 4, 5,
    ]);

    act(() => result.current.setSelected(rows[2]!, false, true));
    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      1, 2,
    ]);
  });

  it("a clear or a page select forgets the anchor", () => {
    const rows = [1, 2, 3, 4].map((prNumber) => makeItem({ prNumber }));
    const { result } = renderHook(() => useInboxSelection(rows));

    act(() => result.current.setSelected(rows[0]!, true));
    act(() => result.current.clear());
    act(() => result.current.setSelected(rows[2]!, true, true));
    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      3,
    ]);

    act(() => result.current.selectPage(true));
    act(() => result.current.setSelected(rows[0]!, false, true));
    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      2, 3, 4,
    ]);
  });

  it("a range with no anchor, or one gone from the page, sets one row", () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: readonly InboxItem[] }) => useInboxSelection(items),
      { initialProps: { items: ROWS } },
    );

    act(() => result.current.setSelected(ROWS[2]!, true, true));
    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      3,
    ]);

    rerender({ items: ROWS.slice(0, 2) });
    act(() => result.current.setSelected(ROWS[0]!, true, true));
    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      1,
    ]);
  });

  it("removing the rows that went leaves every other tick alone", () => {
    const { result } = renderHook(() => useInboxSelection(ROWS));
    act(() => result.current.selectPage(true));

    act(() => result.current.setSelected(ROWS[0]!, false));
    act(() => result.current.remove([ROWS[1]!, { ...ROWS[0]! }]));

    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      3,
    ]);
  });
});

/** The page checkbox above one checkbox per row, as SelectionHeader and InboxRow wire them. */
function StubSelectionList() {
  const selection = useInboxSelection(ROWS);
  return (
    <>
      <Checkbox
        ariaLabel="Page"
        checked={selection.allSelected}
        onChange={selection.selectPage}
      />
      {ROWS.map((row) => (
        <Checkbox
          ariaLabel={`Row ${String(row.prNumber)}`}
          checked={selection.isSelected(row)}
          key={row.prNumber}
          onChange={(checked) => selection.setSelected(row, checked)}
        />
      ))}
      <output>{selection.selectedItems.length}</output>
    </>
  );
}

/** Server markup with the named boxes ticked, as clicks before hydration leave it. */
function stubTickedBeforeHydration(labels: readonly string[]): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = renderToString(<StubSelectionList />);
  document.body.append(container);
  onTestFinished(() => container.remove());
  for (const label of labels) {
    const input = container.querySelector(`input[aria-label="${label}"]`);
    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`no checkbox ${label}`);
    }
    input.checked = true;
  }
  return container;
}

describe("useInboxSelection ticks made before hydration", () => {
  it("selects every row after rows and then the page were ticked", () => {
    const container = stubTickedBeforeHydration(["Row 1", "Row 2", "Page"]);

    render(<StubSelectionList />, { container, hydrate: true });

    expect(screen.getByRole("status").textContent).toBe(String(ROWS.length));
  });

  it("selects only the rows ticked when the page box was not", () => {
    const container = stubTickedBeforeHydration(["Row 1", "Row 3"]);

    render(<StubSelectionList />, { container, hydrate: true });

    expect(screen.getByRole("status").textContent).toBe("2");
  });
});
