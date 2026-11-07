import { describe, expect, it } from "vitest";

import type { ChunkLayoutCounts } from "brief-core/chunk-layout";
import { DiffViews } from "@web/components/DiffRows/types";
import {
  COLLAPSED_CARD_HEIGHT_PX,
  DESKTOP_CARD_METRICS,
  DIFF_ROW_HEIGHT_PX,
  estimateChunkCardHeight,
  estimateReservedChunkCardHeight,
} from "../reading/chunk-height-model";
import type { BriefChunk } from "../../../../model/types";
import { stubLazyDiff } from "../../../../test-utils/fixtures";
import { countStoryChunkRows, estimateStoryChunkHeight } from "./utils";

const TWO_SIDED = {
  addedRanges: [{ start: 10, end: 21 }],
  removedRanges: [{ start: 10, end: 21 }],
};
const ADDED_ONLY = {
  addedRanges: [{ start: 1, end: 12 }],
  removedRanges: [],
};

/** Twelve rows about 100 columns wide: one line unified, two in a split half. */
const MID_WIDTH_COUNTS: ChunkLayoutCounts = {
  rows: 13,
  hunkRows: 1,
  expandRows: 0,
  splitRows: 13,
  lineWidths: { counts: [0, 0, 12, 0, 0, 0, 0, 0, 0], overflowColumns: 0 },
};

const NO_EXPANDED = { diff: 0, expanded: 0 };

describe("estimateStoryChunkHeight", () => {
  it("sizes a one-sided card in a split group in the unified view", () => {
    const height = estimateStoryChunkHeight({
      chunk: ADDED_ONLY,
      groupView: DiffViews.SPLIT,
      counts: MID_WIDTH_COUNTS,
      rows: NO_EXPANDED,
      open: true,
      metrics: DESKTOP_CARD_METRICS,
      large: false,
    });
    const unified = estimateReservedChunkCardHeight({
      counts: MID_WIDTH_COUNTS,
      view: DiffViews.UNIFIED,
      open: true,
      metrics: DESKTOP_CARD_METRICS,
    });
    const split = estimateReservedChunkCardHeight({
      counts: MID_WIDTH_COUNTS,
      view: DiffViews.SPLIT,
      open: true,
      metrics: DESKTOP_CARD_METRICS,
    });

    expect(split).toBeGreaterThan(unified);
    expect(height).toBe(unified);
  });

  it("sizes a two-sided card in the same split group in the split view", () => {
    const height = estimateStoryChunkHeight({
      chunk: TWO_SIDED,
      groupView: DiffViews.SPLIT,
      counts: MID_WIDTH_COUNTS,
      rows: NO_EXPANDED,
      open: true,
      metrics: DESKTOP_CARD_METRICS,
      large: false,
    });

    expect(height).toBe(
      estimateReservedChunkCardHeight({
        counts: MID_WIDTH_COUNTS,
        view: DiffViews.SPLIT,
        open: true,
        metrics: DESKTOP_CARD_METRICS,
      }),
    );
  });

  it("adds expanded rows to an open card and not to a closed one", () => {
    const rows = { diff: 0, expanded: 4 };
    const input = {
      chunk: TWO_SIDED,
      groupView: DiffViews.UNIFIED,
      counts: MID_WIDTH_COUNTS,
      rows,
      large: false,
      metrics: DESKTOP_CARD_METRICS,
    };
    const reservedOpen = estimateReservedChunkCardHeight({
      counts: MID_WIDTH_COUNTS,
      view: DiffViews.UNIFIED,
      open: true,
      metrics: DESKTOP_CARD_METRICS,
    });

    expect(estimateStoryChunkHeight({ ...input, open: true })).toBe(
      reservedOpen + 4 * DIFF_ROW_HEIGHT_PX,
    );
    expect(estimateStoryChunkHeight({ ...input, open: false })).toBe(
      COLLAPSED_CARD_HEIGHT_PX,
    );
  });

  it("sizes a card without counts from its row count", () => {
    const height = estimateStoryChunkHeight({
      chunk: ADDED_ONLY,
      groupView: DiffViews.SPLIT,
      counts: undefined,
      rows: { diff: 7, expanded: 0 },
      open: true,
      metrics: DESKTOP_CARD_METRICS,
      large: false,
    });

    expect(height).toBe(
      estimateChunkCardHeight({
        diffRowCount: 7,
        open: true,
        large: false,
        metrics: DESKTOP_CARD_METRICS,
      }),
    );
  });
});

function makeStoryChunk(id: string): BriefChunk {
  return {
    id,
    changeGroupId: "g1",
    file: `src/${id}.ts`,
    concern: "implementation",
    role: "core",
    loc: { added: 2, deleted: 0 },
    addedRanges: [{ start: 1, end: 2 }],
    removedRanges: [],
    riskSurface: [],
    diff: [
      { kind: "hunk", content: "@@ -0,0 +1,2 @@" },
      { kind: "add", content: "a", newLine: 1 },
      { kind: "add", content: "b", newLine: 2 },
    ],
  } as BriefChunk;
}

describe("countStoryChunkRows", () => {
  it("never reads the rows of a stored, unexpanded card", () => {
    const { entry: chunk, reads } = stubLazyDiff(makeStoryChunk("c1"));

    const rows = countStoryChunkRows({
      chunks: [chunk],
      diffView: DiffViews.UNIFIED,
      expandedEdges: new Map(),
      fileRows: undefined,
      storedCounts: {
        chunks: new Map([["c1", MID_WIDTH_COUNTS]]),
        files: new Map(),
      },
    });

    expect(rows).toEqual([NO_EXPANDED]);
    expect(reads()).toBe(0);
  });

  it("counts a card's sliced rows when no counts were stored", () => {
    const rows = countStoryChunkRows({
      chunks: [makeStoryChunk("c1")],
      diffView: DiffViews.UNIFIED,
      expandedEdges: new Map(),
      fileRows: undefined,
      storedCounts: undefined,
    });

    expect(rows).toEqual([{ diff: 3, expanded: 0 }]);
  });

  it("reads a stored card's rows once the reader expanded an edge", () => {
    const { entry: chunk, reads } = stubLazyDiff(makeStoryChunk("c1"));
    const range = { start: 3, end: 5 };

    const rows = countStoryChunkRows({
      chunks: [chunk],
      diffView: DiffViews.UNIFIED,
      expandedEdges: new Map([["c1:3:down", { range, ranges: [range] }]]),
      fileRows: undefined,
      storedCounts: {
        chunks: new Map([["c1", MID_WIDTH_COUNTS]]),
        files: new Map(),
      },
    });

    expect(rows).toEqual([{ diff: 6, expanded: 3 }]);
    expect(reads()).toBeGreaterThan(0);
  });
});
