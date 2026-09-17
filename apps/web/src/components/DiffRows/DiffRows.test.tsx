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

describe("DiffRows intra-line emphasis", () => {
  const emphasisByRow = new Map([
    [2, [{ from: 0, to: 4 }]],
    [3, [{ from: 0, to: 5 }]],
  ]);

  it("marks the emphasised runs of paired rows in unified view", () => {
    const view = renderRows({ emphasisByRow });
    const marks = view.container.querySelectorAll("mark");

    expect([...marks].map((mark) => mark.textContent)).toEqual([
      "gone",
      "fresh",
    ]);
    expect(view.container.textContent).toContain("−gone");
    expect(view.container.textContent).toContain("+fresh");
  });

  it("marks the same runs inside the split cells", () => {
    const view = renderRows({ emphasisByRow, view: "split" });
    const left = view.container.querySelector('td[data-side="left"] mark');
    const right = view.container.querySelector('td[data-side="right"] mark');

    expect(left?.textContent).toBe("gone");
    expect(right?.textContent).toBe("fresh");
  });
});

describe("DiffRows row slots", () => {
  it("lets a full-row slot replace the hunk cell and keeps the plain note", () => {
    const view = renderRows({
      fullRow: (row, _index, columnCount) =>
        row.kind === "hunk" ? (
          <td colSpan={columnCount} data-testid="expander">
            {row.content}
          </td>
        ) : null,
    });

    const expander = view.getByTestId("expander");
    expect(expander.closest("tr")?.getAttribute("data-line-kind")).toBe("hunk");
    expect(expander.getAttribute("colspan")).toBe("3");
    const note = view.container.querySelector('tr[data-line-kind="note"] td');
    expect(note?.textContent).toBe("truncated");
  });

  it("renders a before-row ahead of the row it names", () => {
    const view = renderRows({
      beforeRow: (_row, index, columnCount) =>
        index === 1 ? (
          <tr data-testid="before">
            <td colSpan={columnCount}>{"\u200B"}</td>
          </tr>
        ) : null,
    });

    const before = view.getByTestId("before");
    expect(before.nextElementSibling?.getAttribute("data-line-kind")).toBe(
      "ctx",
    );
    expect(before.querySelector("td")?.getAttribute("colspan")).toBe("3");
  });

  it("renders a trailing row after the last row in both views", () => {
    const trailingRow = (columnCount: number) => (
      <tr data-testid="trailing">
        <td colSpan={columnCount}>{"\u200B"}</td>
      </tr>
    );
    const unified = renderRows({ trailingRow });
    expect(unified.container.querySelector("tbody")?.lastElementChild).toBe(
      unified.getByTestId("trailing"),
    );
    cleanup();
    const split = renderRows({ trailingRow, view: "split" });
    expect(split.container.querySelector("tbody")?.lastElementChild).toBe(
      split.getByTestId("trailing"),
    );
    expect(split.getByTestId("trailing").querySelector("td")?.colSpan).toBe(4);
  });

  it("keys rows by line so a row keeps its element across a splice above", () => {
    const rows = stubRows();
    const view = renderRows({ rows });
    const fresh = view.container.querySelector('tr[data-line-kind="add"]');
    const spliced: DiffLine[] = [
      {
        kind: "ctx",
        origin: "expanded",
        content: "above",
        oldLine: 0,
        newLine: 0,
      },
      ...rows,
    ];
    view.rerender(
      <table>
        <DiffRows rows={spliced} />
      </table>,
    );

    expect(view.container.querySelector('tr[data-line-kind="add"]')).toBe(
      fresh,
    );
  });
});

describe("DiffRows row origin", () => {
  const expanded: DiffLine[] = [
    {
      kind: "ctx",
      origin: "expanded",
      content: "read",
      oldLine: 4,
      newLine: 4,
    },
    { kind: "del", content: "gone", oldLine: 5 },
    { kind: "add", content: "fresh", newLine: 5 },
  ];

  it("marks origin on the unified expanded row and leaves diff rows bare", () => {
    const view = renderRows({ rows: expanded });
    const rows = view.container.querySelectorAll("tr");

    expect(rows[0]?.getAttribute("data-line-origin")).toBe("expanded");
    expect(rows[1]?.hasAttribute("data-line-origin")).toBe(false);
  });

  it("marks an expanded row's origin on both split cells", () => {
    const view = renderRows({ rows: expanded, view: "split" });
    const cells = view.container.querySelectorAll(
      'td[data-line-origin="expanded"]',
    );

    expect(cells).toHaveLength(4);
    expect(
      view.container.querySelectorAll(
        'td[data-line-kind="del"][data-line-origin]',
      ),
    ).toHaveLength(0);
  });
});

describe("DiffRows repeated line numbers", () => {
  it("keys a repeated line by occurrence and warns about nothing", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const rows: DiffLine[] = [
      { kind: "add", content: "one", newLine: 146 },
      { kind: "hunk", content: "@@ -200,1 +146,1 @@" },
      { kind: "add", content: "two", newLine: 146 },
    ];
    for (const view of ["unified", "split"] as const) {
      const rendered = renderRows({ rows, view });
      expect(rendered.container.querySelectorAll("tr").length).toBe(3);
      cleanup();
    }
    expect(
      errors.mock.calls.some((call) => String(call[0]).includes("same key")),
    ).toBe(false);
    errors.mockRestore();
  });
});

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
