// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DiffLine } from "@web/utils/diffTokens/types";
import { SplitRows } from ".";

function stubRows(): DiffLine[] {
  return [
    { kind: "hunk", content: "@@ -1,2 +1,3 @@" },
    { kind: "ctx", content: "keep", oldLine: 1, newLine: 1 },
    { kind: "del", content: "gone", oldLine: 2 },
    { kind: "add", content: "fresh", newLine: 2 },
    { kind: "add", content: "more", newLine: 3 },
  ];
}

function renderSplit(props: Partial<Parameters<typeof SplitRows>[0]> = {}) {
  return render(
    <table>
      <SplitRows anchorAttributes={{}} rows={stubRows()} {...props} />
    </table>,
  );
}

describe("SplitRows", () => {
  it("pairs a deletion with its replacement on one row", () => {
    const view = renderSplit();
    const rows = view.container.querySelectorAll("tbody > tr");
    const pair = rows[2];

    expect(pair?.querySelector('td[data-side="left"]')?.textContent).toBe("2");
    expect(pair?.querySelector('td[data-side="right"]')?.textContent).toBe("2");
    expect(pair?.textContent).toContain("gone");
    expect(pair?.textContent).toContain("fresh");
  });

  it("fills the empty side of an unmatched addition with exposed cells", () => {
    const view = renderSplit();
    const rows = view.container.querySelectorAll("tbody > tr");
    const fillers = rows[3]?.querySelectorAll('td[data-side="left"]') ?? [];

    expect(fillers).toHaveLength(2);
    expect(fillers[0]?.getAttribute("aria-hidden")).toBeNull();
    expect(fillers[0]?.textContent?.replace(/\u200B/g, "")).toBe("");
  });

  it("marks each side's code cell with its own revision", () => {
    const view = renderSplit({
      rowAttributes: (_row, index) => ({
        revision: index === 2 ? "removed" : "added",
      }),
    });
    const pair = view.container.querySelectorAll("tbody > tr")[2];

    expect(pair?.getAttribute("data-rev")).toBeNull();
    expect(
      pair
        ?.querySelector('td[data-side="left"][data-rev]')
        ?.getAttribute("data-rev"),
    ).toBe("removed");
    expect(
      pair
        ?.querySelector('td[data-side="right"][data-rev]')
        ?.getAttribute("data-rev"),
    ).toBe("added");
  });

  it("marks each side's number cell with its own line", () => {
    const view = renderSplit({
      lineNumberAttributes: { "data-select-anchor": "" },
      anchorAttributes: { "data-comment-anchor": "" },
    });

    expect(
      [
        ...view.container.querySelectorAll(
          'td[data-side="left"][data-line-old]',
        ),
      ].map((cell) => cell.getAttribute("data-line-old")),
    ).toEqual(["1", "2"]);
    expect(
      [
        ...view.container.querySelectorAll(
          'td[data-side="right"][data-line-new]',
        ),
      ].map((cell) => cell.getAttribute("data-line-new")),
    ).toEqual(["1", "2", "3"]);
    expect(
      view.container.querySelectorAll(
        "td[data-select-anchor][data-line-number]",
      ),
    ).toHaveLength(5);
    expect(
      view.container.querySelectorAll("td[data-comment-anchor]"),
    ).toHaveLength(0);
    expect(
      view.container.querySelectorAll("span[data-comment-anchor]"),
    ).toHaveLength(5);
  });

  it("asks the attribute slot once per side and marks that side only", () => {
    const seen: string[] = [];
    const view = renderSplit({
      rowAttributes: (_row, index, side) => {
        seen.push(`${String(index)}:${side ?? "none"}`);
        return { selected: side === "left", focusable: true };
      },
    });
    const pair = view.container.querySelectorAll("tbody > tr")[2];

    expect(seen).toContain("2:left");
    expect(seen).toContain("3:right");
    expect(
      pair?.querySelectorAll('td[data-side="left"][data-selected]'),
    ).toHaveLength(2);
    expect(
      pair?.querySelectorAll('td[data-side="right"][data-selected]'),
    ).toHaveLength(0);
    expect(
      pair?.querySelectorAll('td[data-side="right"][tabindex="0"]'),
    ).toHaveLength(1);
  });

  it("renders the seam cell between the halves and counts its column", () => {
    const view = renderSplit({
      gutterCell: () => <td>g</td>,
      seamCell: () => <td data-testid="seam">s</td>,
      underRow: (_row, _index, columnCount, sideColumns) => (
        <tr data-testid="under">
          <td>{`${String(columnCount)}:${String(sideColumns ?? 0)}`}</td>
        </tr>
      ),
    });
    const pair = view.container.querySelectorAll("tbody > tr")[1];

    expect(pair?.children[3]?.getAttribute("data-testid")).toBe("seam");
    expect(
      view.container
        .querySelector('tr[data-line-kind="hunk"] td')
        ?.getAttribute("colspan"),
    ).toBe("6");
    expect(
      view.container.querySelector('[data-testid="under"] td')?.textContent,
    ).toBe("6:3");
  });

  it("carries the kind on the cells, not the row", () => {
    const view = renderSplit();
    const pair = view.container.querySelectorAll("tbody > tr")[2];

    expect(pair?.getAttribute("data-line-kind")).toBeNull();
    expect(pair?.querySelectorAll('td[data-line-kind="del"]')).toHaveLength(2);
    expect(pair?.querySelectorAll('td[data-line-kind="add"]')).toHaveLength(2);
  });

  it("hands the slots the unified index of each side", () => {
    const seen: number[] = [];
    renderSplit({
      underRow: (_row, index) => {
        seen.push(index);
        return null;
      },
    });

    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it("paints a side's tokens by its unified index", () => {
    const tokensByRow = new Map([[3, [{ text: "fresh", classId: 4 }]]]);
    const view = renderSplit({ tokensByRow });
    const spans = view.container.querySelectorAll(
      'td[data-side="right"] span[class*="syn-"]',
    );

    expect(spans).toHaveLength(1);
    expect(spans[0]?.textContent).toBe("fresh");
  });
});
