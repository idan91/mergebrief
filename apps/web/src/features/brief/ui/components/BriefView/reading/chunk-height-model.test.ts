import { describe, expect, it } from "vitest";

import type { ChunkLayoutCounts } from "brief-core/chunk-layout";
import { DiffViews } from "@web/components/DiffRows/types";
import { ViewportShapes } from "@web/hooks/useViewportShape/types";
import {
  CHUNK_CARD_OVERHEAD_PX,
  COLLAPSED_CARD_HEIGHT_PX,
  countWrappedLines,
  DESKTOP_CARD_METRICS,
  CODE_GLYPH_PX,
  DESKTOP_WRAP_COLUMNS,
  DIFF_ROW_HEIGHT_PX,
  EMPTY_DIFF_NOTE_PX,
  estimateChunkCardHeight,
  estimateNarrativeCardHeight,
  estimateReservedChunkCardHeight,
  estimateReservedRowsHeight,
  LARGE_CHUNK_NOTICE_PX,
  NARRATIVE_CARD_OVERHEAD_PX,
  LANDSCAPE_CARD_METRICS,
  PHONE_CARD_METRICS,
  PHONE_HEAD_EXTRA_PX,
  PHONE_NARRATIVE_HEAD_EXTRA_PX,
  resolveChunkCardMetrics,
  countViewWrappedLines,
  derivePhoneWrapColumns,
  type PhoneLayout,
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
      wrapColumns: DESKTOP_WRAP_COLUMNS,
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
      wrapColumns: DESKTOP_WRAP_COLUMNS,
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
      wrapColumns: DESKTOP_WRAP_COLUMNS,
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
      wrapColumns: DESKTOP_WRAP_COLUMNS,
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

    expect(
      estimateReservedRowsHeight(
        empty,
        DiffViews.UNIFIED,
        DESKTOP_WRAP_COLUMNS,
      ),
    ).toBe(EMPTY_DIFF_NOTE_PX);
    expect(
      estimateReservedChunkCardHeight({
        counts: empty,
        view: DiffViews.SPLIT,
        open: true,
        metrics: DESKTOP_CARD_METRICS,
        wrapColumns: DESKTOP_WRAP_COLUMNS,
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

    expect(
      estimateReservedRowsHeight(counts, DiffViews.SPLIT, DESKTOP_WRAP_COLUMNS),
    ).toBe(282);
    expect(
      estimateReservedRowsHeight(
        counts,
        DiffViews.UNIFIED,
        DESKTOP_WRAP_COLUMNS,
      ),
    ).toBe(304);
  });

  it("wraps the split view by the unified widths when no pair differs", () => {
    const counts = makeCounts({
      lineWidths: { counts: [8, 0, 0, 0, 2, 0, 0, 0, 0], overflowColumns: 0 },
    });

    expect(
      estimateReservedRowsHeight(counts, DiffViews.SPLIT, DESKTOP_WRAP_COLUMNS),
    ).toBe(348);
  });
});

const PHONE_390: PhoneLayout = { widthPx: 390, cardBleeds: true };

describe("derivePhoneWrapColumns", () => {
  it.each([
    [320, true, 30, 22],
    [390, true, 39, 22],
    [524, true, 56, 22],
    [600, true, 66, 27],
    [759, true, 86, 37],
    [760, false, 75, 31],
    [768, false, 76, 32],
    [800, false, 80, 34],
    [880, false, 90, 39],
    [844, false, 86, 37],
    [932, false, 97, 42],
  ])(
    "fits a %ipx phone's code cells",
    (widthPx, cardBleeds, unified, split) => {
      expect(derivePhoneWrapColumns({ widthPx, cardBleeds })).toEqual({
        unified,
        split,
      });
    },
  );

  it.each([
    [750, true, 47, 47, 74],
    [750, true, 59, 0, 77],
    [844, false, 47, 47, 86],
    [844, false, 59, 59, 83],
    [932, false, 59, 59, 94],
  ])(
    "narrows a %ipx phone's code by its notch insets",
    (widthPx, cardBleeds, leftPx, rightPx, unified) => {
      const insets = { leftPx, rightPx };
      const columns = derivePhoneWrapColumns({ widthPx, cardBleeds, insets });

      expect(columns.unified).toBe(unified);
    },
  );

  it("matches a 390px unified cell's 306px of code", () => {
    const { unified } = derivePhoneWrapColumns(PHONE_390);

    expect(unified).toBe(Math.floor(306 / CODE_GLYPH_PX));
  });

  it("keeps the default root's columns when the root size is unknown", () => {
    const unknownRoot = { ...PHONE_390, remPx: undefined };

    expect(derivePhoneWrapColumns(unknownRoot)).toEqual(
      derivePhoneWrapColumns(PHONE_390),
    );
  });

  it("fits a 285.5px unified cell's code under a 20px root font", () => {
    const largeText = { ...PHONE_390, remPx: 20 };

    expect(derivePhoneWrapColumns(largeText)).toEqual({
      unified: Math.floor(285.5 / (CODE_GLYPH_PX * 1.25)),
      split: 16,
    });
  });

  it("wraps a 100-column line into three on a phone and one on a desktop", () => {
    const phoneColumns = derivePhoneWrapColumns(PHONE_390);
    const counts = makeCounts({
      rows: 4,
      hunkRows: 0,
      expandRows: 0,
      splitRows: 4,
      lineWidths: { counts: [0, 0, 4, 0, 0, 0, 0, 0, 0], overflowColumns: 0 },
    });

    expect(countViewWrappedLines(counts, DiffViews.UNIFIED, phoneColumns)).toBe(
      4 * 2,
    );
    expect(
      countViewWrappedLines(counts, DiffViews.UNIFIED, DESKTOP_WRAP_COLUMNS),
    ).toBe(0);
    expect(
      estimateReservedRowsHeight(counts, DiffViews.UNIFIED, phoneColumns),
    ).toBe(12 * DIFF_ROW_HEIGHT_PX);
  });
});

describe("resolveChunkCardMetrics", () => {
  it("takes the phone metrics at or under the mobile breakpoint", () => {
    expect(resolveChunkCardMetrics(ViewportShapes.PHONE)).toBe(
      PHONE_CARD_METRICS,
    );
    expect(resolveChunkCardMetrics(ViewportShapes.DESKTOP)).toBe(
      DESKTOP_CARD_METRICS,
    );
  });

  it("prices a sideways phone's one-line head under the desktop's", () => {
    expect(resolveChunkCardMetrics(ViewportShapes.LANDSCAPE_PHONE)).toBe(
      LANDSCAPE_CARD_METRICS,
    );
    expect(LANDSCAPE_CARD_METRICS).toEqual({
      overheadPx: 92,
      collapsedPx: 52,
      narrativeOverheadPx: 159,
    });
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
    const phone = {
      counts,
      view: DiffViews.UNIFIED,
      open: true,
      wrapColumns: DESKTOP_WRAP_COLUMNS,
    };

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
