import { describe, expect, it } from "vitest";

import {
  CHUNK_CARD_OVERHEAD_PX,
  COLLAPSED_CARD_HEIGHT_PX,
  DIFF_ROW_HEIGHT_PX,
  estimateChunkCardHeight,
} from "./chunkHeightModel";

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

  it("prices a diff-less open card as chrome only", () => {
    expect(estimateChunkCardHeight({ diffRowCount: 0, open: true })).toBe(
      CHUNK_CARD_OVERHEAD_PX,
    );
  });

  it("is deterministic — same input, same number (SSR parity relies on it)", () => {
    const input = { diffRowCount: 27, open: true };
    expect(estimateChunkCardHeight(input)).toBe(
      estimateChunkCardHeight({ ...input }),
    );
  });
});
