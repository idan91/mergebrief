// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "sass";
import { describe, expect, it, vi } from "vitest";
import { SYNTAX_PALETTE } from "@web/utils/diffTokens/palette";
import type { DiffLine } from "@web/utils/diffTokens/types";
import { DiffRows } from ".";
import tokenStyles from "./DiffCodeText/DiffCodeText.module.scss";
import styles from "./DiffRows.module.scss";
import { DiffViews } from "./types";
import { isFullWidthDiffRow } from "./utils";

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
    const marks = view.container.querySelectorAll(
      '[data-testid="diff-emphasis"]',
    );

    expect([...marks].map((mark) => mark.textContent)).toEqual([
      "gone",
      "fresh",
    ]);
    expect(view.container.textContent).toContain("−gone");
    expect(view.container.textContent).toContain("+fresh");
  });

  it("marks the same runs inside the split cells", () => {
    const view = renderRows({ emphasisByRow, view: "split" });
    const left = view.container.querySelector(
      'td[data-side="left"] [data-testid="diff-emphasis"]',
    );
    const right = view.container.querySelector(
      'td[data-side="right"] [data-testid="diff-emphasis"]',
    );

    expect(left?.textContent).toBe("gone");
    expect(right?.textContent).toBe("fresh");
  });
});

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const ROW_STYLESHEET = join(TEST_DIRECTORY, "DiffRows.module.scss");
const STYLES_DIRECTORY = join(TEST_DIRECTORY, "../../styles");
const UNIFIED_HANG =
  /\.line > \.code \{[^}]*padding-inline-start: calc\(1\.5rem \+ min\(var\(--code-indent, 0\) \* 1ch, 16ch\)\);\s*text-indent: calc\(-1 \* \(1rem \+ min\(var\(--code-indent, 0\) \* 1ch, 16ch\)\)\)/;
const SPLIT_HANG =
  /\.line > \.code\[data-side\] \{[^}]*padding-inline-start: calc\(1\.5rem \+ min\(var\(--code-indent, 0\) \* 1ch, 8ch\)\);\s*text-indent: calc\(-1 \* \(1rem \+ min\(var\(--code-indent, 0\) \* 1ch, 8ch\)\)\)/;
const TOKEN_STYLESHEET = join(
  TEST_DIRECTORY,
  "DiffCodeText",
  "DiffCodeText.module.scss",
);
const RULE = /([^{}]+)\{([^{}]*)\}/g;
const LOCAL_CLASS = /\.([a-zA-Z_][\w-]*)/g;
const LIFTED_TOKENS = ["keyword", "comment"] as const;

function findClassId(token: string): number {
  return SYNTAX_PALETTE.findIndex((entry) => entry.token === token);
}

/** One line per side whose single emphasised run holds a keyword and a comment token. */
function stubEmphasisedPair() {
  const sides = [
    { line: { kind: "del", oldLine: 1 }, texts: ["return", " a; ", "// old"] },
    { line: { kind: "add", newLine: 1 }, texts: ["return", " b; ", "// new"] },
  ] as const;
  const tokenKinds = ["keyword", "text", "comment"];
  const rows: DiffLine[] = sides.map((side) => ({
    ...side.line,
    content: side.texts.join(""),
  }));
  const tokensByRow = new Map(
    sides.map((side, index) => [
      index,
      side.texts.map((text, at) => ({
        text,
        classId: findClassId(tokenKinds[at] ?? "text"),
      })),
    ]),
  );
  const emphasisByRow = new Map(
    rows.map((row, index) => [index, [{ from: 0, to: row.content.length }]]),
  );
  return { rows, tokensByRow, emphasisByRow };
}

/** Compiled rules that colour from `liftToken`, in the class names the module hands the component. */
function readLiftSelectors(liftToken: string): string[] {
  const { css } = compile(TOKEN_STYLESHEET);
  const selectors: string[] = [];
  for (const [, selector = "", body = ""] of css.matchAll(RULE)) {
    if (body.includes(`var(${liftToken})`)) {
      selectors.push(selector.trim());
    }
  }

  return selectors.map((selector) =>
    selector.replace(LOCAL_CLASS, (_whole, name: string) => {
      return `.${tokenStyles[name] ?? name}`;
    }),
  );
}

/** `<token>:lifted` or `<token>:base` for each keyword and comment token inside an emphasised run. */
function readEmphasisedTokenColours(container: HTMLElement): string[] {
  const colours: string[] = [];
  const runs = container.querySelectorAll('[data-testid="diff-emphasis"]');
  for (const run of runs) {
    for (const token of LIFTED_TOKENS) {
      const span = run.querySelector(`span[class*="syn-${token}"]`);
      const selectors = readLiftSelectors(`--syn-${token}-emphasis`);
      const lifted = selectors.some((selector) => span?.matches(selector));
      colours.push(`${token}:${lifted ? "lifted" : "base"}`);
    }
  }

  return colours;
}

describe("DiffRows emphasis contrast", () => {
  it.each(Object.values(DiffViews))(
    "lifts emphasised keyword and comment tokens in the %s view",
    (diffView) => {
      const { rows, ...props } = stubEmphasisedPair();
      const view = render(
        <table>
          <DiffRows rows={rows} view={diffView} {...props} />
        </table>,
      );

      expect(readEmphasisedTokenColours(view.container)).toEqual([
        "keyword:lifted",
        "comment:lifted",
        "keyword:lifted",
        "comment:lifted",
      ]);
    },
  );
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

  it("marks each number cell with the line it shows", () => {
    const view = renderRows();

    const old = view.container.querySelectorAll("td[data-line-old]");
    const fresh = view.container.querySelectorAll("td[data-line-new]");
    expect([...old].map((cell) => cell.getAttribute("data-line-old"))).toEqual([
      "1",
      "2",
    ]);
    expect(
      [...fresh].map((cell) => cell.getAttribute("data-line-new")),
    ).toEqual(["1", "2"]);
    // The old number cell never claims a new line, nor the reverse.
    expect(
      view.container.querySelector("td[data-line-old][data-line-new]"),
    ).toBeNull();
  });

  it("number attributes land on number cells, anchor ones on the sign", () => {
    const view = renderRows({
      anchorAttributes: { "data-comment-anchor": "" },
      lineNumberAttributes: { "data-select-anchor": "" },
    });

    expect(
      view.container.querySelectorAll("td[data-select-anchor]"),
    ).toHaveLength(6);
    expect(
      view.container.querySelectorAll("td[data-comment-anchor]"),
    ).toHaveLength(0);
    expect(
      view.container.querySelectorAll("span[data-comment-anchor]"),
    ).toHaveLength(3);
  });

  it("renders the number cell slot after the number, per side", () => {
    const view = renderRows({
      lineNumberContent: (row, _index, side) =>
        side === "new" && row.kind === "add" ? <i>glyph</i> : null,
    });

    const glyphs = view.container.querySelectorAll("td[data-line-new] i");
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0]?.parentElement?.textContent).toBe("2glyph");
  });

  it("signs added and deleted rows", () => {
    const view = renderRows();

    const signs = view.container.querySelectorAll(
      'tr[data-line-kind="del"] td:not([data-line-number]) span, tr[data-line-kind="add"] td:not([data-line-number]) span',
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
    if (row) {
      fireEvent.keyDown(row, { key: "Enter" });
    }
    expect(onKeyDown).toHaveBeenCalledTimes(1);
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

  it.each([
    [DiffViews.UNIFIED, ["8", "4", ""]],
    [DiffViews.SPLIT, ["8", "4", "", ""]],
  ])("writes each %s code cell's indent in columns", (view, indents) => {
    const rows: DiffLine[] = [
      { kind: "del", content: "\tgone", oldLine: 1 },
      { kind: "add", content: "    fresh", newLine: 1 },
      { kind: "ctx", content: "keep", oldLine: 2, newLine: 2 },
    ];
    const rendered = renderRows({ rows, view });
    const cells = rendered.container.querySelectorAll<HTMLElement>(
      `td.${styles["code"] ?? "code"}`,
    );

    expect(
      [...cells].map((cell) => cell.style.getPropertyValue("--code-indent")),
    ).toEqual(indents);
  });

  it("hangs a phone line's wrap under its indent in both views", () => {
    const { css } = compile(ROW_STYLESHEET, { loadPaths: [STYLES_DIRECTORY] });

    expect(css).toMatch(UNIFIED_HANG);
    expect(css).toMatch(SPLIT_HANG);
  });
});
