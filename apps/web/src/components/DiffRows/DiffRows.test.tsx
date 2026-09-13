// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiffLine } from "@web/utils/diffTokens/types";
import { DiffRows } from "./DiffRows";
import { isFullWidthDiffRow } from "./utils";

afterEach(cleanup);

function stubRows(): DiffLine[] {
  return [
    { kind: "hunk", content: "@@ -1,2 +1,2 @@" },
    { kind: "ctx", content: "keep", oldLine: 1, newLine: 1 },
    { kind: "del", content: "gone", oldLine: 2 },
    { kind: "add", content: "fresh", newLine: 2 },
    { kind: "note", content: "truncated" },
  ];
}

function renderRows(props: Partial<Parameters<typeof DiffRows>[0]> = {}) {
  return render(
    <table>
      <DiffRows rows={stubRows()} {...props} />
    </table>,
  );
}

describe("DiffRows", () => {
  it("renders one row per line with its kind and line numbers", () => {
    const view = renderRows();

    const rows = view.container.querySelectorAll("tr[data-line-kind]");
    expect(rows).toHaveLength(5);
    const numbers = view.container.querySelectorAll("[data-line-number]");
    expect([...numbers].map((cell) => cell.textContent)).toEqual([
      "1",
      "1",
      "2",
      "",
      "",
      "2",
    ]);
  });

  it("gives hunk and note rows a single spanning cell", () => {
    const view = renderRows();

    const meta = view.container.querySelectorAll(
      'tr[data-line-kind="hunk"] td, tr[data-line-kind="note"] td',
    );
    expect(meta).toHaveLength(2);
    expect([...meta].map((cell) => cell.getAttribute("colspan"))).toEqual([
      "3",
      "3",
    ]);
  });

  it("signs added and deleted rows", () => {
    const view = renderRows();

    const signs = view.container.querySelectorAll(
      'tr[data-line-kind="del"] td span, tr[data-line-kind="add"] td span',
    );
    expect([...signs].map((span) => span.textContent)).toEqual(["−", "+"]);
  });

  it("widens the spanning cell when a gutter slot is given", () => {
    const view = renderRows({ gutterCell: () => <td>{"rail"}</td> });

    const hunkCell = view.container.querySelector(
      'tr[data-line-kind="hunk"] td',
    );
    expect(hunkCell?.getAttribute("colspan")).toBe("4");
  });

  it("drops both number cells when line numbers are off", () => {
    const view = renderRows({ lineNumbers: false });

    expect(view.container.querySelectorAll("[data-line-number]")).toHaveLength(
      0,
    );
    const hunkCell = view.container.querySelector(
      'tr[data-line-kind="hunk"] td',
    );
    expect(hunkCell?.getAttribute("colspan")).toBe("1");
  });

  it("hands the under-row slot the column count to span", () => {
    const view = renderRows({
      gutterCell: () => <td>{"rail"}</td>,
      lineNumbers: false,
      underRow: (row, _index, columnCount) =>
        row.kind === "ctx" ? (
          <tr>
            <td colSpan={columnCount} data-testid="under">
              {"under"}
            </td>
          </tr>
        ) : null,
    });

    expect(
      view.container
        .querySelector('[data-testid="under"]')
        ?.getAttribute("colspan"),
    ).toBe("2");
  });

  it("puts composer attributes and handlers on the row", () => {
    const onKeyDown = vi.fn();
    const view = renderRows({
      rowAttributes: () => ({
        commentable: true,
        focusable: true,
        selected: true,
        revision: "added",
        onKeyDown,
      }),
    });

    const row = view.container.querySelector('tr[data-line-kind="ctx"]');
    expect(row?.getAttribute("data-commentable")).toBe("");
    expect(row?.getAttribute("data-selected")).toBe("");
    expect(row?.getAttribute("data-rev")).toBe("added");
    expect(row?.getAttribute("tabindex")).toBe("0");
    if (row) fireEvent.keyDown(row, { key: "Enter" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("marks the anchor cells a composer asks for", () => {
    const view = renderRows({
      anchorAttributes: { "data-comment-anchor": "" },
    });

    expect(
      view.container.querySelectorAll("[data-comment-anchor]"),
    ).toHaveLength(9);
  });

  it("renders the code trailer and under-row slots", () => {
    const view = renderRows({
      codeTrailer: (row) => (row.kind === "add" ? <b>tag</b> : null),
      underRow: (row, index) =>
        row.kind === "add" ? (
          <tr data-testid="under">
            <td>{index}</td>
          </tr>
        ) : null,
    });

    expect(view.container.querySelectorAll("b")).toHaveLength(1);
    expect(
      view.container.querySelector('[data-testid="under"] td')?.textContent,
    ).toBe("3");
  });

  it("renders one gutter cell per row when a gutter slot is given", () => {
    const view = renderRows({
      gutterCell: () => <td data-testid="gutter">g</td>,
    });
    const rows = view.container.querySelectorAll("tr[data-line-kind]");
    const gutters = view.container.querySelectorAll('[data-testid="gutter"]');
    const fullWidth = stubRows().filter(isFullWidthDiffRow).length;

    expect(gutters).toHaveLength(rows.length - fullWidth);
  });

  it("paints a row's tokens as spans keyed by its row index", () => {
    const tokensByRow = new Map([[3, [{ text: "fresh", classId: 4 }]]]);
    const view = renderRows({ tokensByRow });
    const rows = view.container.querySelectorAll("tr[data-line-kind]");
    const painted = rows[3]?.querySelectorAll('span[class*="syn-"]') ?? [];
    const plain = rows[2]?.querySelectorAll('span[class*="syn-"]') ?? [];

    expect(painted).toHaveLength(1);
    expect(painted[0]?.textContent).toBe("fresh");
    expect(plain).toHaveLength(0);
  });

  it("marks the body pending while tokens are on their way", () => {
    const view = renderRows({ tokensPending: true });

    expect(view.container.querySelector("tbody")?.dataset["tokens"]).toBe(
      "pending",
    );
    expect(
      renderRows().container.querySelector("tbody")?.dataset["tokens"],
    ).toBe(undefined);
  });
});
