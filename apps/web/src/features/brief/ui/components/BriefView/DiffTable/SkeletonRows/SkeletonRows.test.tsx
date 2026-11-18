// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, cleanup, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiffViews } from "@web/components/DiffRows/types";
import { DESKTOP_WRAP_COLUMNS } from "../../reading/chunk-height-model";
import { SkeletonRows } from ".";
import { MAX_SKELETON_ROWS } from "./consts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query === "(prefers-reduced-motion: reduce)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function readStylesheet(path: string): string {
  return readFileSync(join(TEST_DIR, path), "utf8");
}

const STYLESHEET = readStylesheet("SkeletonRows.module.scss");
const SWEEPS_BEFORE_SCRIPT =
  /animation: shine-band var\(--shine-cycle\) linear var\(--shine-delay, 0ms\)\s+infinite;/;

const SPLIT_ROWS_STYLESHEET = readStylesheet(
  "../../../../../../../components/DiffRows/SplitRows/SplitRows.module.scss",
);
const HATCHED_CELL_STYLESHEETS = [
  readStylesheet("SkeletonCodeRow/SkeletonCodeRow.module.scss"),
  readStylesheet("SkeletonCodeRow/SkeletonText/SkeletonText.module.scss"),
];
const HATCH_STRENGTH =
  /var\(--color-line-strong\) (\d+)%, transparent\) 6px 7px/;
const REDUCED_MOTION_HIDES_SHINE =
  /@media \(prefers-reduced-motion: reduce\) \{\s*\.shine \{\s*display: none;/;

/** Two hunks: a removed line paired with two added, then one added; a trailing expand row. */
const COUNTS = {
  rows: 11,
  hunkRows: 2,
  expandRows: 1,
  splitRows: 10,
  lineWidths: { counts: [9, 0, 0, 0, 0, 0, 0, 0, 0], overflowColumns: 0 },
  splitLineWidths: {
    counts: [8, 0, 0, 0, 0, 0, 0, 0, 0],
    overflowColumns: 0,
  },
  rowRuns: "h1c1r1a2c2h1c1a1c1e1",
};

const { rowRuns: _rowRuns, ...NO_ROW_RUNS } = COUNTS;

function readRows(): Element[] {
  return [...(screen.getByTestId("skeleton-rows").children[1]?.children ?? [])];
}

function readVariants(row: Element | undefined): (string | null)[] {
  return [...(row?.querySelectorAll("[data-variant]") ?? [])].map((cell) =>
    cell.getAttribute("data-variant"),
  );
}

describe("SkeletonRows", () => {
  it("marks itself busy and names the wait for a screen reader", () => {
    render(
      <SkeletonRows
        counts={COUNTS}
        view={DiffViews.UNIFIED}
        wrapColumns={DESKTOP_WRAP_COLUMNS}
      />,
    );

    const skeleton = screen.getByTestId("skeleton-rows");
    expect(skeleton.getAttribute("aria-busy")).toBe("true");
    expect(skeleton.textContent).toBe("Loading the code for this chunk");
  });

  it("hides its rows from assistive tech, one element per row", () => {
    render(
      <SkeletonRows
        counts={COUNTS}
        view={DiffViews.UNIFIED}
        wrapColumns={DESKTOP_WRAP_COLUMNS}
      />,
    );

    const rows = screen.getByTestId("skeleton-rows").children[1];
    expect(rows?.getAttribute("aria-hidden")).toBe("true");
    expect(rows?.children).toHaveLength(12);
  });

  it("reserves exactly the lines the height model prices", () => {
    render(
      <SkeletonRows
        counts={COUNTS}
        view={DiffViews.UNIFIED}
        wrapColumns={DESKTOP_WRAP_COLUMNS}
      />,
    );
    const unified = screen.getByTestId("skeleton-rows");
    expect(unified.style.getPropertyValue("--skeleton-block-size")).toBe(
      "291px",
    );
    cleanup();

    render(
      <SkeletonRows
        counts={COUNTS}
        view={DiffViews.SPLIT}
        wrapColumns={DESKTOP_WRAP_COLUMNS}
      />,
    );
    const split = screen.getByTestId("skeleton-rows");
    expect(split.style.getPropertyValue("--skeleton-block-size")).toBe("269px");
  });

  it("draws the stored added and removed rows in muted colour", () => {
    render(
      <SkeletonRows
        counts={COUNTS}
        view={DiffViews.UNIFIED}
        wrapColumns={DESKTOP_WRAP_COLUMNS}
      />,
    );
    const rows = readRows();

    expect(screen.getByTestId("skeleton-rows").dataset["ink"]).toBe("mirror");
    expect(rows[2]?.getAttribute("data-variant")).toBe("removed");
    expect(rows[3]?.getAttribute("data-variant")).toBe("added");
    expect(rows[9]?.getAttribute("data-variant")).toBe("added");
    expect(rows[1]?.getAttribute("data-variant")).toBe("context");
    expect(readVariants(rows[2])).toEqual(["removed", "empty", "removed"]);
  });

  it("hatches the split view's empty side across from a lone change", () => {
    render(
      <SkeletonRows
        counts={COUNTS}
        view={DiffViews.SPLIT}
        wrapColumns={DESKTOP_WRAP_COLUMNS}
      />,
    );
    const rows = readRows();

    expect(readVariants(rows[2])).toEqual([
      "removed",
      "removed",
      "added",
      "added",
    ]);
    expect(readVariants(rows[3])).toEqual(["empty", "empty", "added", "added"]);
    expect(rows[3]?.children).toHaveLength(4);
  });

  it("draws no colour and no hatch without stored row runs", () => {
    render(
      <SkeletonRows
        counts={NO_ROW_RUNS}
        view={DiffViews.SPLIT}
        wrapColumns={DESKTOP_WRAP_COLUMNS}
      />,
    );
    const skeleton = screen.getByTestId("skeleton-rows");
    const coloured = skeleton.querySelectorAll(
      "[data-variant='added'], [data-variant='removed'], [data-variant='empty']",
    );

    expect(skeleton.dataset["ink"]).toBe("neutral");
    expect(coloured).toHaveLength(0);
    expect(readRows()).toHaveLength(11);
  });

  it("sizes the number columns to the card's widest line number", () => {
    render(
      <SkeletonRows
        counts={COUNTS}
        digits={4}
        view={DiffViews.UNIFIED}
        wrapColumns={DESKTOP_WRAP_COLUMNS}
      />,
    );

    const skeleton = screen.getByTestId("skeleton-rows");
    expect(skeleton.style.getPropertyValue("--skeleton-digits")).toBe("4");
  });

  it("lays one hidden shine over the block, carrying the same rows", () => {
    render(
      <SkeletonRows
        counts={COUNTS}
        view={DiffViews.UNIFIED}
        wrapColumns={DESKTOP_WRAP_COLUMNS}
      />,
    );

    const shine = screen.getByTestId("skeleton-shine");
    expect(shine.parentElement).toBe(screen.getByTestId("skeleton-rows"));
    expect(shine.getAttribute("aria-hidden")).toBe("true");
    expect(shine.children[0]?.children).toHaveLength(12);
  });

  it("sweeps from the first paint, before script sets a phase", () => {
    expect(STYLESHEET).toMatch(SWEEPS_BEFORE_SCRIPT);
  });

  it("drops the shine when the reader asks for reduced motion", () => {
    expect(STYLESHEET).toMatch(REDUCED_MOTION_HIDES_SHINE);
  });

  it("fills a capped card's well past its rows, on the shine too", () => {
    const counts = { ...NO_ROW_RUNS, rows: 5000 };
    render(
      <SkeletonRows
        counts={counts}
        view={DiffViews.UNIFIED}
        wrapColumns={DESKTOP_WRAP_COLUMNS}
      />,
    );

    const rows = screen.getByTestId("skeleton-rows").children[1];
    const track = screen.getByTestId("skeleton-shine").children[0];
    expect(rows?.children.length).toBeLessThanOrEqual(MAX_SKELETON_ROWS + 1);
    expect(rows?.children.length).toBeGreaterThan(MAX_SKELETON_ROWS - 10);
    expect(rows?.lastElementChild?.getAttribute("data-testid")).toBe(
      "skeleton-fill",
    );
    expect(track?.children).toHaveLength(rows?.children.length ?? 0);
    expect(track?.lastElementChild?.getAttribute("data-testid")).toBe(
      "skeleton-fill",
    );
  });

  it("hatches an empty side as softly as the split table does", () => {
    const table = HATCH_STRENGTH.exec(SPLIT_ROWS_STYLESHEET)?.[1];
    const cells = HATCHED_CELL_STYLESHEETS.map(
      (sheet) => HATCH_STRENGTH.exec(sheet)?.[1],
    );

    expect(table).toBe("55");
    expect(cells).toEqual([table, table]);
  });

  it("mounts no shine when the reader asks for reduced motion", () => {
    stubReducedMotion(true);
    render(
      <SkeletonRows
        counts={COUNTS}
        view={DiffViews.UNIFIED}
        wrapColumns={DESKTOP_WRAP_COLUMNS}
      />,
    );

    expect(screen.getByTestId("skeleton-rows")).toBeTruthy();
    expect(screen.queryByTestId("skeleton-shine")).toBeNull();
  });

  it("hydrates the server's shine, then drops it under reduced motion", async () => {
    stubReducedMotion(true);
    const element = (
      <SkeletonRows
        counts={COUNTS}
        view={DiffViews.UNIFIED}
        wrapColumns={DESKTOP_WRAP_COLUMNS}
      />
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(element);
    document.body.append(container);
    const recoverable = vi.fn();
    const consoleError = vi.spyOn(console, "error");

    await act(async () => {
      hydrateRoot(container, element, { onRecoverableError: recoverable });
    });

    expect(recoverable).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="skeleton-shine"]'),
    ).toBeNull();
    container.remove();
  });
});
