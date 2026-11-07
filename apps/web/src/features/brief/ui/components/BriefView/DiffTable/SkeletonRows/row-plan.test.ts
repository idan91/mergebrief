import { describe, expect, it } from "vitest";

import type { ChunkLayoutCounts } from "brief-core/chunk-layout";
import { DiffViews } from "@web/components/DiffRows/types";
import { DESKTOP_WRAP_COLUMNS } from "../../reading/chunk-height-model";
import { MAX_SKELETON_ROWS } from "./consts";
import { planSkeletonRows } from "./row-plan";
import {
  SkeletonInks,
  SkeletonRowTypes,
  type SkeletonPlan,
  type PlannedRow,
} from "./types";

const NARROW = { counts: [9, 0, 0, 0, 0, 0, 0, 0, 0], overflowColumns: 0 };

/** Two hunks: a removed line paired with two added, then one added; a trailing expand row. */
function makeCounts(
  overrides: Partial<ChunkLayoutCounts> = {},
): ChunkLayoutCounts {
  return {
    rows: 11,
    hunkRows: 2,
    expandRows: 1,
    splitRows: 10,
    lineWidths: NARROW,
    splitLineWidths: {
      counts: [8, 0, 0, 0, 0, 0, 0, 0, 0],
      overflowColumns: 0,
    },
    rowRuns: "h1c1r1a2c2h1c1a1c1e1",
    ...overrides,
  };
}

function describeRow(row: PlannedRow): string {
  if (row.type === SkeletonRowTypes.LANE) {
    return row.band ? "hunk" : "expand";
  }
  if (row.right === undefined) {
    return row.left.kind;
  }
  return `${row.left.kind}|${row.right.kind}`;
}

function countLines(plan: SkeletonPlan): number {
  return plan.rows.reduce(
    (lines, row) => lines + (row.type === SkeletonRowTypes.CODE ? row.span : 1),
    0,
  );
}

describe("planSkeletonRows", () => {
  it("draws the stored row runs in place in the unified view", () => {
    const plan = planSkeletonRows(
      makeCounts(),
      DiffViews.UNIFIED,
      DESKTOP_WRAP_COLUMNS,
    );

    expect(plan.ink).toBe(SkeletonInks.MIRROR);
    expect(plan.rows.map(describeRow)).toEqual([
      "hunk",
      "context",
      "removed",
      "added",
      "added",
      "context",
      "context",
      "hunk",
      "context",
      "added",
      "context",
      "expand",
    ]);
  });

  it("pairs a removed run with the added run after it in the split view", () => {
    const plan = planSkeletonRows(
      makeCounts(),
      DiffViews.SPLIT,
      DESKTOP_WRAP_COLUMNS,
    );

    expect(plan.rows.map(describeRow)).toEqual([
      "hunk",
      "context|context",
      "removed|added",
      "empty|added",
      "context|context",
      "context|context",
      "hunk",
      "context|context",
      "empty|added",
      "context|context",
      "expand",
    ]);
  });

  it("draws every row as context when no row runs are stored", () => {
    const { rowRuns: _rowRuns, ...counts } = makeCounts();
    const plan = planSkeletonRows(
      counts,
      DiffViews.SPLIT,
      DESKTOP_WRAP_COLUMNS,
    );
    const kinds = new Set(plan.rows.map(describeRow));

    expect(plan.ink).toBe(SkeletonInks.NEUTRAL);
    expect([...kinds].toSorted()).toEqual([
      "context|context",
      "expand",
      "hunk",
    ]);
    expect(countLines(plan)).toBe(11);
  });

  it("draws neutral when the row runs disagree with the counts", () => {
    const plan = planSkeletonRows(
      makeCounts({ rowRuns: "h1c9r1a2c2h1c1a1c1e1" }),
      DiffViews.UNIFIED,
      DESKTOP_WRAP_COLUMNS,
    );

    expect(plan.ink).toBe(SkeletonInks.NEUTRAL);
    expect(plan.rows.map(describeRow)).not.toContain("added");
  });

  it("draws the lines the view reserves, wraps included", () => {
    const counts = makeCounts({
      lineWidths: { counts: [7, 0, 2, 0, 0, 0, 0, 0, 0], overflowColumns: 0 },
      splitLineWidths: {
        counts: [7, 0, 1, 0, 0, 0, 0, 0, 0],
        overflowColumns: 0,
      },
    });

    expect(
      countLines(
        planSkeletonRows(counts, DiffViews.UNIFIED, DESKTOP_WRAP_COLUMNS),
      ),
    ).toBe(12);
    expect(
      countLines(
        planSkeletonRows(counts, DiffViews.SPLIT, DESKTOP_WRAP_COLUMNS),
      ),
    ).toBe(12);
  });

  it("wraps a split row once for its wider side, not once per side", () => {
    const counts = makeCounts({
      lineWidths: { counts: [7, 0, 2, 0, 0, 0, 0, 0, 0], overflowColumns: 0 },
      splitLineWidths: {
        counts: [7, 0, 1, 0, 0, 0, 0, 0, 0],
        overflowColumns: 0,
      },
    });
    const plan = planSkeletonRows(
      counts,
      DiffViews.SPLIT,
      DESKTOP_WRAP_COLUMNS,
    );
    const spans = plan.rows.map((row) =>
      row.type === SkeletonRowTypes.CODE ? row.span : 1,
    );

    expect(spans.filter((span) => span === 2)).toHaveLength(1);
  });

  it("pads split context rows by the unified widths when no pair differs", () => {
    const { splitLineWidths: _widths, ...counts } = makeCounts({
      lineWidths: { counts: [7, 0, 2, 0, 0, 0, 0, 0, 0], overflowColumns: 0 },
    });

    expect(
      countLines(
        planSkeletonRows(counts, DiffViews.SPLIT, DESKTOP_WRAP_COLUMNS),
      ),
    ).toBe(13);
  });

  it("caps a very long card's lines and fills the rest of its well", () => {
    const { rowRuns: _rowRuns, ...counts } = makeCounts({
      rows: 5000,
      splitRows: 5000,
    });
    const plan = planSkeletonRows(
      counts,
      DiffViews.UNIFIED,
      DESKTOP_WRAP_COLUMNS,
    );

    expect(plan.filled).toBe(true);
    expect(countLines(plan)).toBeLessThanOrEqual(MAX_SKELETON_ROWS);
    expect(countLines(plan)).toBeGreaterThan(MAX_SKELETON_ROWS - 2);
  });

  it("draws nothing for an empty slice", () => {
    const plan = planSkeletonRows(
      makeCounts({
        rows: 0,
        hunkRows: 0,
        expandRows: 0,
        splitRows: 0,
        lineWidths: { counts: [0, 0, 0, 0, 0, 0, 0, 0, 0], overflowColumns: 0 },
        rowRuns: "",
      }),
      DiffViews.UNIFIED,
      DESKTOP_WRAP_COLUMNS,
    );

    expect(plan.rows).toEqual([]);
    expect(plan.filled).toBe(false);
  });

  it("keeps every row the same across plans of the same counts", () => {
    const first = planSkeletonRows(
      makeCounts(),
      DiffViews.SPLIT,
      DESKTOP_WRAP_COLUMNS,
    );
    const second = planSkeletonRows(
      makeCounts(),
      DiffViews.SPLIT,
      DESKTOP_WRAP_COLUMNS,
    );

    expect(first).toEqual(second);
  });

  it("stops at the cap however long the stored runs are", () => {
    const rows = 1_000_000_000;
    const counts = makeCounts({
      rows: rows + 1,
      hunkRows: 1,
      expandRows: 0,
      splitRows: rows + 1,
      rowRuns: `h1c${String(rows)}`,
    });
    const startedAt = performance.now();

    const plan = planSkeletonRows(
      counts,
      DiffViews.SPLIT,
      DESKTOP_WRAP_COLUMNS,
    );

    expect(plan.filled).toBe(true);
    expect(countLines(plan)).toBeLessThanOrEqual(MAX_SKELETON_ROWS);
    expect(performance.now() - startedAt).toBeLessThan(1000);
  });
});
