// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { InboxReviewStates } from "types/inbox";
import { describe, expect, it } from "vitest";

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
    generation: null,
    latestBriefAt: null,
    githubUpdatedAt: null,
    stack: null,
    ...overrides,
  };
}

const ROWS = [
  makeItem({ prNumber: 1 }),
  makeItem({ prNumber: 2, viewerCanDelete: true }),
  makeItem({ prNumber: 3 }),
];

describe("useInboxSelection", () => {
  it("toggles rows by key and derives the page states", () => {
    const { result } = renderHook(() => useInboxSelection(ROWS));

    expect(result.current.selectedItems).toEqual([]);
    expect(result.current.someSelected).toBe(false);
    expect(result.current.allSelected).toBe(false);

    act(() => result.current.toggle(ROWS[1]!));
    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      2,
    ]);
    expect(result.current.someSelected).toBe(true);
    expect(result.current.allSelected).toBe(false);

    act(() => result.current.toggle(ROWS[1]!));
    expect(result.current.selectedItems).toEqual([]);
  });

  it("select page ticks every row; a second call clears them", () => {
    const { result } = renderHook(() => useInboxSelection(ROWS));

    act(() => result.current.selectPage());
    expect(result.current.allSelected).toBe(true);
    expect(result.current.someSelected).toBe(false);
    expect(result.current.selectedItems).toHaveLength(3);

    act(() => result.current.selectPage());
    expect(result.current.selectedItems).toEqual([]);
  });

  it("keeps only the rows still on the page, by key, and clears on demand", () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: readonly InboxItem[] }) => useInboxSelection(items),
      { initialProps: { items: ROWS } },
    );
    act(() => result.current.selectPage());

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

  it("a range toggle gives the span the clicked row's new state", () => {
    const rows = [1, 2, 3, 4, 5].map((prNumber) => makeItem({ prNumber }));
    const { result } = renderHook(() => useInboxSelection(rows));

    act(() => result.current.toggle(rows[1]!));
    act(() => result.current.toggle(rows[3]!, true));
    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      2, 3, 4,
    ]);

    act(() => result.current.toggle(rows[0]!, true));
    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      1, 2, 3, 4,
    ]);

    act(() => result.current.toggle(rows[2]!));
    act(() => result.current.toggle(rows[4]!, true));
    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      1, 2, 3, 4, 5,
    ]);

    act(() => result.current.toggle(rows[2]!, true));
    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      1, 2,
    ]);
  });

  it("a clear or a page select forgets the anchor", () => {
    const rows = [1, 2, 3, 4].map((prNumber) => makeItem({ prNumber }));
    const { result } = renderHook(() => useInboxSelection(rows));

    act(() => result.current.toggle(rows[0]!));
    act(() => result.current.clear());
    act(() => result.current.toggle(rows[2]!, true));
    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      3,
    ]);

    act(() => result.current.selectPage());
    act(() => result.current.toggle(rows[0]!, true));
    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      2, 3, 4,
    ]);
  });

  it("a range with no anchor, or one gone from the page, toggles one row", () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: readonly InboxItem[] }) => useInboxSelection(items),
      { initialProps: { items: ROWS } },
    );

    act(() => result.current.toggle(ROWS[2]!, true));
    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      3,
    ]);

    rerender({ items: ROWS.slice(0, 2) });
    act(() => result.current.toggle(ROWS[0]!, true));
    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      1,
    ]);
  });

  it("removing the rows that went leaves every other tick alone", () => {
    const { result } = renderHook(() => useInboxSelection(ROWS));
    act(() => result.current.selectPage());

    act(() => result.current.toggle(ROWS[0]!));
    act(() => result.current.remove([ROWS[1]!, { ...ROWS[0]! }]));

    expect(result.current.selectedItems.map((row) => row.prNumber)).toEqual([
      3,
    ]);
  });
});
