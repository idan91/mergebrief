import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChunkLayoutCounts } from "brief-core/chunk-layout";
import { DiffViews } from "@web/components/DiffRows/types";
import {
  alignShine,
  MAX_SKELETON_ROWS,
  planSkeletonRows,
  resolveShineDelay,
  SHINE_CYCLE_MS,
} from "./utils";

function makeCounts(
  overrides: Partial<ChunkLayoutCounts> = {},
): ChunkLayoutCounts {
  return {
    rows: 10,
    hunkRows: 2,
    expandRows: 1,
    splitRows: 7,
    lineWidths: { counts: [10, 0, 0, 0, 0, 0, 0, 0, 0], overflowColumns: 0 },
    ...overrides,
  };
}

describe("planSkeletonRows", () => {
  it("plans the unified rows plus the expand rows, tall ones spread out", () => {
    const { rows } = planSkeletonRows(makeCounts(), DiffViews.UNIFIED);

    expect(rows).toHaveLength(11);
    expect(rows.filter((row) => row.tall).map((row) => row.index)).toEqual([
      0, 3, 7,
    ]);
  });

  it("plans the split view from its paired rows", () => {
    expect(planSkeletonRows(makeCounts(), DiffViews.SPLIT).rows).toHaveLength(
      8,
    );
  });

  it("keeps bar widths fixed per row index", () => {
    const first = planSkeletonRows(makeCounts(), DiffViews.UNIFIED);
    const second = planSkeletonRows(makeCounts(), DiffViews.UNIFIED);

    expect(first.rows.map((row) => row.width)).toEqual(
      second.rows.map((row) => row.width),
    );
  });

  it("caps a very long card's rows and fills the rest of its well", () => {
    const plan = planSkeletonRows(
      makeCounts({ rows: 5000 }),
      DiffViews.UNIFIED,
    );

    expect(plan.rows).toHaveLength(MAX_SKELETON_ROWS);
    expect(plan.filled).toBe(true);
  });

  it("leaves a card that fits under the cap without a fill", () => {
    expect(planSkeletonRows(makeCounts(), DiffViews.UNIFIED).filled).toBe(
      false,
    );
  });
});

describe("resolveShineDelay", () => {
  it("steps a later sweep to the phase the first one has reached", () => {
    expect(resolveShineDelay(SHINE_CYCLE_MS * 3 + 250, 0)).toBe(-250);
    expect(resolveShineDelay(900, 400)).toBe(-500);
  });

  it("keeps the phase in one cycle when the sweep starts first", () => {
    expect(resolveShineDelay(300, 400)).toBe(-(SHINE_CYCLE_MS - 100));
  });
});

describe("alignShine", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubShine(written: Map<string, string>): HTMLElement {
    return {
      style: {
        setProperty: (name: string, value: string) => written.set(name, value),
      },
    } as unknown as HTMLElement;
  }

  it("aligns to the first paint, when the rendered sweeps started", () => {
    vi.spyOn(performance, "getEntriesByName").mockReturnValue([
      { startTime: 400 } as PerformanceEntry,
    ]);
    const written = new Map<string, string>();

    alignShine(stubShine(written), 900);

    expect(written.get("--shine-delay")).toBe("-500ms");
  });

  it("aligns to the clock's origin before any paint is recorded", () => {
    vi.spyOn(performance, "getEntriesByName").mockReturnValue([]);
    const written = new Map<string, string>();

    alignShine(stubShine(written), SHINE_CYCLE_MS + 250);

    expect(written.get("--shine-delay")).toBe("-250ms");
  });
});
