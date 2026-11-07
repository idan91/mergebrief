import { describe, expect, it } from "vitest";

import type { ChunkLayoutCounts } from "brief-core/chunk-layout";
import { DiffViews } from "@web/components/DiffRows/types";
import {
  CHUNK_CARD_OVERHEAD_PX,
  COLLAPSED_CARD_HEIGHT_PX,
  countWrappedLines,
  DESKTOP_CARD_METRICS,
  DIFF_ROW_HEIGHT_PX,
  EMPTY_DIFF_NOTE_PX,
  estimateChunkCardHeight,
  estimateNarrativeCardHeight,
  estimateReservedChunkCardHeight,
  estimateReservedRowsHeight,
  LARGE_CHUNK_NOTICE_PX,
  NARRATIVE_CARD_OVERHEAD_PX,
  PHONE_CARD_METRICS,
  PHONE_HEAD_EXTRA_PX,
  PHONE_NARRATIVE_HEAD_EXTRA_PX,
  resolveChunkCardMetrics,
  SPLIT_CODE_COLUMNS,
  TALL_ROW_EXTRA_PX,
  UNIFIED_CODE_COLUMNS,
} from "./chunk-height-model";

const NARROW_HISTOGRAM = {
  counts: [10, 0, 0, 0, 0, 0, 0, 0, 0],
  overflowColumns: 0,
};

function makeCounts(
  overrides: Partial<ChunkLayoutCounts> = {},
): ChunkLayoutCounts {
  return {
    rows: 10,
    hunkRows: 1,
    expandRows: 1,
    splitRows: 8,
    lineWidths: NARROW_HISTOGRAM,
    ...overrides,
  };
}

describe("estimateReservedChunkCardHeight", () => {
  it("reserves the rows, the expand rows and the tall-row extra", () => {
    const height = estimateReservedChunkCardHeight({
      counts: makeCounts(),
      view: DiffViews.UNIFIED,
      open: true,
      metrics: DESKTOP_CARD_METRICS,
    });

    expect(height).toBe(
      11 * DIFF_ROW_HEIGHT_PX + 2 * TALL_ROW_EXTRA_PX + CHUNK_CARD_OVERHEAD_PX,
    );
  });

  it("reserves the split view from its paired rows", () => {
    const height = estimateReservedChunkCardHeight({
      counts: makeCounts(),
      view: DiffViews.SPLIT,
      open: true,
      metrics: DESKTOP_CARD_METRICS,
    });

    expect(height).toBe(
      9 * DIFF_ROW_HEIGHT_PX + 2 * TALL_ROW_EXTRA_PX + CHUNK_CARD_OVERHEAD_PX,
    );
  });

  it("prices a collapsed card as its head, large notice included", () => {
    const closed = {
      counts: makeCounts(),
      view: DiffViews.UNIFIED,
      open: false,
      metrics: DESKTOP_CARD_METRICS,
    };

    expect(estimateReservedChunkCardHeight(closed)).toBe(
      COLLAPSED_CARD_HEIGHT_PX,
    );
    expect(estimateReservedChunkCardHeight({ ...closed, large: true })).toBe(
      COLLAPSED_CARD_HEIGHT_PX + LARGE_CHUNK_NOTICE_PX,
    );
  });

  it("adds a row for every line that wraps past the column", () => {
    const wide = makeCounts({
      rows: 2,
      hunkRows: 0,
      expandRows: 0,
      lineWidths: { counts: [1, 0, 0, 0, 0, 0, 0, 1, 0], overflowColumns: 0 },
    });

    const height = estimateReservedChunkCardHeight({
      counts: wide,
      view: DiffViews.UNIFIED,
      open: true,
      metrics: DESKTOP_CARD_METRICS,
    });

    expect(height).toBe(
      (2 + countWrappedLines(wide.lineWidths, UNIFIED_CODE_COLUMNS)) *
        DIFF_ROW_HEIGHT_PX +
        CHUNK_CARD_OVERHEAD_PX,
    );
  });
});

describe("countWrappedLines", () => {
  it("counts no wrap for rows under the column", () => {
    expect(countWrappedLines(NARROW_HISTOGRAM, UNIFIED_CODE_COLUMNS)).toBe(0);
  });

  it("wraps a bucket at its midpoint", () => {
    const histogram = {
      counts: [0, 0, 0, 0, 0, 0, 0, 3, 0],
      overflowColumns: 0,
    };

    expect(countWrappedLines(histogram, UNIFIED_CODE_COLUMNS)).toBe(3 * 3);
    expect(countWrappedLines(histogram, SPLIT_CODE_COLUMNS)).toBe(3 * 6);
  });

  it("wraps the open bucket by its mean width", () => {
    const histogram = {
      counts: [0, 0, 0, 0, 0, 0, 0, 0, 2],
      overflowColumns: 1200,
    };

    expect(countWrappedLines(histogram, UNIFIED_CODE_COLUMNS)).toBe(2 * 4);
  });
});

describe("estimateChunkCardHeight", () => {
  it("scales an open card by its diff row count", () => {
    expect(
      estimateChunkCardHeight({
        diffRowCount: 40,
        open: true,
        metrics: DESKTOP_CARD_METRICS,
      }),
    ).toBe(40 * DIFF_ROW_HEIGHT_PX + CHUNK_CARD_OVERHEAD_PX);
  });

  it("prices a collapsed card as its head only, regardless of rows", () => {
    expect(
      estimateChunkCardHeight({
        diffRowCount: 400,
        open: false,
        metrics: DESKTOP_CARD_METRICS,
      }),
    ).toBe(COLLAPSED_CARD_HEIGHT_PX);
    expect(
      estimateChunkCardHeight({
        diffRowCount: 0,
        open: false,
        metrics: DESKTOP_CARD_METRICS,
      }),
    ).toBe(COLLAPSED_CARD_HEIGHT_PX);
  });

  it("adds the large-diff notice to a closed large card only", () => {
    expect(
      estimateChunkCardHeight({
        diffRowCount: 900,
        open: false,
        large: true,
        metrics: DESKTOP_CARD_METRICS,
      }),
    ).toBe(COLLAPSED_CARD_HEIGHT_PX + LARGE_CHUNK_NOTICE_PX);
    expect(
      estimateChunkCardHeight({
        diffRowCount: 900,
        open: true,
        large: true,
        metrics: DESKTOP_CARD_METRICS,
      }),
    ).toBe(900 * DIFF_ROW_HEIGHT_PX + CHUNK_CARD_OVERHEAD_PX);
  });

  it("prices a diff-less open card as chrome plus the unavailable note", () => {
    // 40% under-estimating these made briefs with missing diffs visibly
    // reshuffle at first paint (every card renders the note, not rows).
    expect(
      estimateChunkCardHeight({
        diffRowCount: 0,
        open: true,
        metrics: DESKTOP_CARD_METRICS,
      }),
    ).toBe(CHUNK_CARD_OVERHEAD_PX + EMPTY_DIFF_NOTE_PX);
  });
});

describe("estimateNarrativeCardHeight", () => {
  it("scales by added rows plus chrome", () => {
    expect(
      estimateNarrativeCardHeight({
        rowCount: 10,
        hasRemovedNote: false,
        metrics: DESKTOP_CARD_METRICS,
      }),
    ).toBe(10 * DIFF_ROW_HEIGHT_PX + NARRATIVE_CARD_OVERHEAD_PX);
  });

  it("adds the removed-note line only when present", () => {
    const withNote = estimateNarrativeCardHeight({
      rowCount: 0,
      hasRemovedNote: true,
      metrics: DESKTOP_CARD_METRICS,
    });
    const without = estimateNarrativeCardHeight({
      rowCount: 0,
      hasRemovedNote: false,
      metrics: DESKTOP_CARD_METRICS,
    });
    expect(withNote).toBeGreaterThan(without);
    expect(without).toBe(NARRATIVE_CARD_OVERHEAD_PX);
  });
});

describe("estimateReservedRowsHeight", () => {
  it("reserves an empty slice at the note it renders once the code lands", () => {
    const empty = makeCounts({
      rows: 0,
      hunkRows: 0,
      expandRows: 0,
      splitRows: 0,
      lineWidths: { counts: [0, 0, 0, 0, 0, 0, 0, 0, 0], overflowColumns: 0 },
    });

    expect(estimateReservedRowsHeight(empty, DiffViews.UNIFIED)).toBe(
      EMPTY_DIFF_NOTE_PX,
    );
    expect(
      estimateReservedChunkCardHeight({
        counts: empty,
        view: DiffViews.SPLIT,
        open: true,
        metrics: DESKTOP_CARD_METRICS,
      }),
    ).toBe(
      estimateChunkCardHeight({
        diffRowCount: 0,
        open: true,
        metrics: DESKTOP_CARD_METRICS,
      }),
    );
  });

  it("wraps a split row once for its wider side, not once per side", () => {
    const counts = makeCounts({
      lineWidths: { counts: [8, 0, 0, 0, 2, 0, 0, 0, 0], overflowColumns: 0 },
      splitLineWidths: {
        counts: [7, 0, 0, 0, 1, 0, 0, 0, 0],
        overflowColumns: 0,
      },
    });

    expect(estimateReservedRowsHeight(counts, DiffViews.SPLIT)).toBe(282);
    expect(estimateReservedRowsHeight(counts, DiffViews.UNIFIED)).toBe(304);
  });

  it("wraps the split view by the unified widths when no pair differs", () => {
    const counts = makeCounts({
      lineWidths: { counts: [8, 0, 0, 0, 2, 0, 0, 0, 0], overflowColumns: 0 },
    });

    expect(estimateReservedRowsHeight(counts, DiffViews.SPLIT)).toBe(348);
  });
});

describe("resolveChunkCardMetrics", () => {
  it("takes the phone metrics at or under the mobile breakpoint", () => {
    expect(resolveChunkCardMetrics(true)).toBe(PHONE_CARD_METRICS);
    expect(resolveChunkCardMetrics(false)).toBe(DESKTOP_CARD_METRICS);
  });

  it("pins the phone chrome the two-line head reserves", () => {
    expect(PHONE_CARD_METRICS).toEqual({
      overheadPx: 104,
      collapsedPx: 64,
      narrativeOverheadPx: 159,
    });
  });

  it("prices the phone's 56px two-line head over the desktop head", () => {
    const counts = makeCounts();
    const phone = { counts, view: DiffViews.UNIFIED, open: true };

    expect(
      estimateReservedChunkCardHeight({
        ...phone,
        metrics: PHONE_CARD_METRICS,
      }),
    ).toBe(
      estimateReservedChunkCardHeight({
        ...phone,
        metrics: DESKTOP_CARD_METRICS,
      }) + PHONE_HEAD_EXTRA_PX,
    );
    expect(
      estimateChunkCardHeight({
        diffRowCount: 0,
        open: false,
        metrics: PHONE_CARD_METRICS,
      }),
    ).toBe(COLLAPSED_CARD_HEIGHT_PX + PHONE_HEAD_EXTRA_PX);
  });

  it("prices the phone narrative head's counts line", () => {
    expect(
      estimateNarrativeCardHeight({
        rowCount: 0,
        hasRemovedNote: false,
        metrics: PHONE_CARD_METRICS,
      }),
    ).toBe(NARRATIVE_CARD_OVERHEAD_PX + PHONE_NARRATIVE_HEAD_EXTRA_PX);
  });
});
