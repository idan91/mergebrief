import { describe, expect, it } from "vitest";

import {
  CHUNK_CARD_OVERHEAD_PX,
  COLLAPSED_CARD_HEIGHT_PX,
  DIFF_ROW_HEIGHT_PX,
  EMPTY_DIFF_NOTE_PX,
  estimateChunkCardHeight,
  estimateNarrativeCardHeight,
  LARGE_CHUNK_NOTICE_PX,
  NARRATIVE_CARD_OVERHEAD_PX,
} from "./chunk-height-model";

describe("estimateChunkCardHeight", () => {
  it("scales an open card by its diff row count", () => {
    expect(estimateChunkCardHeight({ diffRowCount: 40, open: true })).toBe(
      40 * DIFF_ROW_HEIGHT_PX + CHUNK_CARD_OVERHEAD_PX,
    );
  });

  it("prices a collapsed card as its head only, regardless of rows", () => {
    expect(estimateChunkCardHeight({ diffRowCount: 400, open: false })).toBe(
      COLLAPSED_CARD_HEIGHT_PX,
    );
    expect(estimateChunkCardHeight({ diffRowCount: 0, open: false })).toBe(
      COLLAPSED_CARD_HEIGHT_PX,
    );
  });

  it("adds the large-diff notice to a closed large card only", () => {
    expect(
      estimateChunkCardHeight({ diffRowCount: 900, open: false, large: true }),
    ).toBe(COLLAPSED_CARD_HEIGHT_PX + LARGE_CHUNK_NOTICE_PX);
    expect(
      estimateChunkCardHeight({ diffRowCount: 900, open: true, large: true }),
    ).toBe(900 * DIFF_ROW_HEIGHT_PX + CHUNK_CARD_OVERHEAD_PX);
  });

  it("prices a diff-less open card as chrome plus the unavailable note", () => {
    // 40% under-estimating these made briefs with missing diffs visibly
    // reshuffle at first paint (every card renders the note, not rows).
    expect(estimateChunkCardHeight({ diffRowCount: 0, open: true })).toBe(
      CHUNK_CARD_OVERHEAD_PX + EMPTY_DIFF_NOTE_PX,
    );
  });
});

describe("estimateNarrativeCardHeight", () => {
  it("scales by added rows plus chrome", () => {
    expect(
      estimateNarrativeCardHeight({ rowCount: 10, hasRemovedNote: false }),
    ).toBe(10 * DIFF_ROW_HEIGHT_PX + NARRATIVE_CARD_OVERHEAD_PX);
  });

  it("adds the removed-note line only when present", () => {
    const withNote = estimateNarrativeCardHeight({
      rowCount: 0,
      hasRemovedNote: true,
    });
    const without = estimateNarrativeCardHeight({
      rowCount: 0,
      hasRemovedNote: false,
    });
    expect(withNote).toBeGreaterThan(without);
    expect(without).toBe(NARRATIVE_CARD_OVERHEAD_PX);
  });
});
