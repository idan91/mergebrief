import { describe, expect, it } from "vitest";

import type { DiffLine } from "@web/utils/diffTokens/types";
import type { BriefChunk } from "../../../../model/types";
import type { ExpandableEdge } from "../../../../model/expansion/types";
import type { DiffRowView } from "./diffRowView";
import { pairSplitRows } from "@web/components/DiffRows/pairSplitRows";
import type { SiblingSpan } from "../../../../model/utils/siblingSpans";
import { RailSides } from "./types";
import type { ComparisonRun } from "../../../../model/comparison/runs";
import { GuestRowReasons } from "../../../../model/types";
import type { GuestRowResolution } from "../../../utils/guest-rows";
import {
  collectGuestReasons,
  deriveSideRail,
  collectOldSideRuns,
  collectDragBaseIndexes,
  frameSpans,
  frameSpansOnPairs,
  resolveBeforeRowEdges,
  resolveHunkRowEdges,
  resolveSpanLines,
  resolveSpanRangeOwner,
  mapToBaseIndexes,
  unzipPairsByOwner,
} from "./utils";

const ROWS: DiffLine[] = [
  { kind: "ctx", origin: "expanded", content: "k", oldLine: 9, newLine: 9 },
  { kind: "del", origin: "expanded", content: "x1", oldLine: 10 },
  { kind: "del", origin: "expanded", content: "x2", oldLine: 11 },
  { kind: "add", origin: "expanded", content: "y1", newLine: 10 },
  { kind: "add", origin: "expanded", content: "y2", newLine: 11 },
  { kind: "ctx", content: "own", oldLine: 12, newLine: 12 },
];
const SPANS: SiblingSpan[] = [
  { start: 1, end: 2, owner: "x" },
  { start: 3, end: 4, owner: "y" },
];

describe("frameSpans", () => {
  it("frames a unified span on its own rows", () => {
    expect(frameSpans(SPANS)).toEqual([
      { owner: "x", headerAt: 1, endAt: 2, rows: [1, 2] },
      { owner: "y", headerAt: 3, endAt: 4, rows: [3, 4] },
    ]);
  });
});

describe("frameSpansOnPairs", () => {
  it("leaves a pair that straddles two owners unframed", () => {
    const pairs = pairSplitRows(ROWS);

    expect(frameSpansOnPairs(SPANS, pairs)).toEqual([]);
  });

  it("frames the pairs whose two cells share the owner, once per pair", () => {
    const rows: DiffLine[] = [
      { kind: "del", origin: "expanded", content: "x1", oldLine: 10 },
      { kind: "add", origin: "expanded", content: "x2", newLine: 10 },
      { kind: "add", origin: "expanded", content: "x3", newLine: 11 },
      { kind: "ctx", content: "own", oldLine: 11, newLine: 12 },
    ];
    const spans: SiblingSpan[] = [{ start: 0, end: 2, owner: "x" }];

    expect(frameSpansOnPairs(spans, pairSplitRows(rows))).toEqual([
      { owner: "x", headerAt: 0, endAt: 2, rows: [0, 1, 2] },
    ]);
  });

  it("closes a frame at the pair where the owner changes", () => {
    const rows: DiffLine[] = [
      { kind: "add", origin: "expanded", content: "x1", newLine: 10 },
      { kind: "del", origin: "expanded", content: "x2", oldLine: 11 },
      { kind: "add", origin: "expanded", content: "y1", newLine: 11 },
      { kind: "add", origin: "expanded", content: "y2", newLine: 12 },
    ];
    const spans: SiblingSpan[] = [
      { start: 0, end: 0, owner: "x" },
      { start: 1, end: 1, owner: "x" },
      { start: 2, end: 3, owner: "y" },
    ];

    expect(frameSpansOnPairs(spans, pairSplitRows(rows))).toEqual([
      { owner: "x", headerAt: 0, endAt: 0, rows: [0] },
      { owner: "y", headerAt: 3, endAt: 3, rows: [3] },
    ]);
  });
});

describe("resolveSpanLines", () => {
  it("reads the new side of the changed rows and skips context", () => {
    const rows: DiffLine[] = [
      { kind: "del", origin: "expanded", content: "x", oldLine: 20 },
      {
        kind: "ctx",
        origin: "expanded",
        content: "k",
        oldLine: 21,
        newLine: 19,
      },
      { kind: "add", origin: "expanded", content: "y", newLine: 20 },
      { kind: "add", origin: "expanded", content: "y", newLine: 21 },
    ];

    expect(resolveSpanLines(rows, [0, 1, 2, 3])).toEqual({
      side: "new",
      from: 20,
      to: 21,
    });
  });

  it("reads the old side when the span only deletes", () => {
    const rows: DiffLine[] = [
      { kind: "del", origin: "expanded", content: "x", oldLine: 20 },
      {
        kind: "ctx",
        origin: "expanded",
        content: "k",
        oldLine: 21,
        newLine: 19,
      },
      { kind: "del", origin: "expanded", content: "x", oldLine: 22 },
    ];

    expect(resolveSpanLines(rows, [0, 1, 2])).toEqual({
      side: "old",
      from: 20,
      to: 22,
    });
  });
});

describe("unzipPairsByOwner", () => {
  const owners: Record<number, string> = { 1: "x", 2: "x", 3: "y", 4: "y" };

  it("splits a pair whose sides belong to different owners", () => {
    const pairs = unzipPairsByOwner(
      pairSplitRows(ROWS),
      (index) => owners[index],
    );

    expect(pairs.map((pair) => [pair.left?.index, pair.right?.index])).toEqual([
      [0, 0],
      [1, undefined],
      [2, undefined],
      [undefined, 3],
      [undefined, 4],
      [5, 5],
    ]);
    expect(new Set(pairs.map((pair) => pair.key)).size).toBe(pairs.length);
  });

  it("keeps a pair the chunk's own rows or one owner share", () => {
    const pairs = unzipPairsByOwner(pairSplitRows(ROWS), () => undefined);

    expect(pairs).toHaveLength(4);
  });
});

describe("mapToBaseIndexes", () => {
  it("returns the indexes untouched when nothing is spliced", () => {
    expect(mapToBaseIndexes([2, 3], undefined)).toEqual([2, 3]);
  });

  it("maps rendered indexes to base ones through the splice", () => {
    expect(mapToBaseIndexes([1, 2], [0, 5, 6, -1])).toEqual([5, 6]);
  });

  it("answers nothing when a picked row is expanded context", () => {
    expect(mapToBaseIndexes([2, 3], [0, 5, 6, -1])).toBeUndefined();
  });
});

describe("collectDragBaseIndexes", () => {
  it("keeps the base rows of a drag and drops the expanded ones", () => {
    expect([
      ...collectDragBaseIndexes(new Set([0, 1, 3]), [4, -1, 5, 6]),
    ]).toEqual([4, 6]);
  });
});

describe("resolveSpanRangeOwner", () => {
  const owners = new Map([["c2", { id: "c2" }]]) as unknown as ReadonlyMap<
    string,
    BriefChunk
  >;
  const views = [
    { isCommentable: true },
    { isCommentable: true },
    { isCommentable: false },
  ] as unknown as DiffRowView[];

  it("names the one owner of a commentable range inside a span", () => {
    const byRow = new Map([
      [0, "c2"],
      [1, "c2"],
    ]);

    expect(resolveSpanRangeOwner([0, 1], byRow, views, owners)?.id).toBe("c2");
  });

  it("refuses a range that leaves the span or crosses context", () => {
    const byRow = new Map([
      [0, "c2"],
      [1, "c3"],
      [2, "c2"],
    ]);

    expect(resolveSpanRangeOwner([0, 1], byRow, views, owners)).toBeUndefined();
    expect(
      resolveSpanRangeOwner(
        [0, 2],
        new Map([
          [0, "c2"],
          [2, "c2"],
        ]),
        views,
        owners,
      ),
    ).toBeUndefined();
  });
});

describe("expand slot edges", () => {
  const makeEdge = (direction: "up" | "down") =>
    ({ gap: { edge: { direction } } }) as unknown as ExpandableEdge;
  const byRow = new Map([
    [3, [makeEdge("down")]],
    [4, [makeEdge("up"), makeEdge("down")]],
    [7, [makeEdge("up")]],
  ]);

  it("gives a hunk row its own edges plus the up edge right under it", () => {
    const own = resolveHunkRowEdges(byRow, 3);

    expect(own.map((candidate) => candidate.gap.edge.direction)).toEqual([
      "down",
      "up",
    ]);
  });

  it("keeps a row's up edge off the row under a hunk header", () => {
    const ctx = { kind: "ctx", content: "" } as DiffLine;
    const hunk = { kind: "hunk", content: "" } as DiffLine;

    expect(resolveBeforeRowEdges(byRow, 4, ctx, hunk)).toHaveLength(1);
    expect(resolveBeforeRowEdges(byRow, 7, ctx, ctx)).toHaveLength(1);
    expect(resolveBeforeRowEdges(byRow, 3, hunk, ctx)).toHaveLength(0);
  });

  it("hosts nothing when the header above took the row's only up edge", () => {
    const ctx = { kind: "ctx", content: "" } as DiffLine;
    const hunk = { kind: "hunk", content: "" } as DiffLine;

    expect(resolveBeforeRowEdges(byRow, 7, ctx, hunk)).toHaveLength(0);
    expect(resolveBeforeRowEdges(byRow, 7, ctx, undefined)).toHaveLength(1);
  });
});

describe("deriveSideRail", () => {
  const oldRun: ComparisonRun = {
    chunkId: "c1",
    file: "src/a.ts",
    rowIndexes: [1, 2],
    kind: "added",
  };
  const newRun: ComparisonRun = {
    chunkId: "c1",
    file: "src/a.ts",
    rowIndexes: [5, 6],
    kind: "added",
  };
  const touchesOld = (run: ComparisonRun) => run === oldRun;
  function stubView(
    run: ComparisonRun | undefined,
    caps: { start?: boolean; end?: boolean } = {},
  ): DiffRowView {
    return {
      id: "r",
      isCommentable: true,
      revRun: run,
      revMark: undefined,
      isRevStart: caps.start === true,
      isRevEnd: caps.end === true,
      rowComments: [],
      rowAddressedComments: [],
      isSelected: false,
      showComposer: false,
    };
  }

  it("paints a run touching old lines on the edge, never the seam", () => {
    const left = stubView(oldRun, { start: true });
    const right = stubView(oldRun, { end: true });
    expect(
      deriveSideRail({
        side: RailSides.EDGE,
        own: left,
        other: right,
        hasSeam: true,
        touchesOld,
      }),
    ).toEqual({ run: oldRun, isStart: true, isEnd: true });
    expect(
      deriveSideRail({
        side: RailSides.SEAM,
        own: right,
        other: left,
        hasSeam: true,
        touchesOld,
      }),
    ).toEqual({ run: undefined, isStart: false, isEnd: false });
  });

  it("paints a new-only run on the seam, capped on the right side", () => {
    const left = stubView(undefined);
    const right = stubView(newRun, { start: true, end: true });
    expect(
      deriveSideRail({
        side: RailSides.SEAM,
        own: right,
        other: left,
        hasSeam: true,
        touchesOld,
      }),
    ).toEqual({ run: newRun, isStart: true, isEnd: true });
    expect(
      deriveSideRail({
        side: RailSides.EDGE,
        own: left,
        other: right,
        hasSeam: true,
        touchesOld,
      }),
    ).toEqual({ run: undefined, isStart: false, isEnd: false });
  });

  it("gives the edge the old-touching run when a pair straddles two runs", () => {
    const left = stubView(oldRun, { end: true });
    const right = stubView(newRun, { start: true });
    expect(
      deriveSideRail({
        side: RailSides.EDGE,
        own: right,
        other: left,
        hasSeam: true,
        touchesOld,
      }),
    ).toEqual({ run: oldRun, isStart: false, isEnd: true });
    expect(
      deriveSideRail({
        side: RailSides.SEAM,
        own: right,
        other: left,
        hasSeam: true,
        touchesOld,
      }),
    ).toEqual({ run: newRun, isStart: true, isEnd: false });
  });

  it("paints nothing where neither side has a run", () => {
    expect(
      deriveSideRail({
        side: RailSides.EDGE,
        own: stubView(undefined),
        other: undefined,
        hasSeam: true,
        touchesOld,
      }),
    ).toEqual({ run: undefined, isStart: false, isEnd: false });
  });

  it("paints every run on the edge when the view has no seam", () => {
    expect(
      deriveSideRail({
        side: RailSides.EDGE,
        own: stubView(newRun, { start: true }),
        other: undefined,
        hasSeam: false,
        touchesOld,
      }),
    ).toEqual({ run: newRun, isStart: true, isEnd: false });
  });
});

describe("collectOldSideRuns", () => {
  it("keeps the runs holding a deleted base row", () => {
    const withDeletion: ComparisonRun = {
      chunkId: "c1",
      file: "src/a.ts",
      rowIndexes: [1, 3],
      kind: "added",
    };
    const additionsOnly: ComparisonRun = {
      chunkId: "c1",
      file: "src/a.ts",
      rowIndexes: [4],
      kind: "added",
    };
    const oldSide = collectOldSideRuns([withDeletion, additionsOnly], ROWS);

    expect(oldSide.has(withDeletion)).toBe(true);
    expect(oldSide.has(additionsOnly)).toBe(false);
  });
});

describe("collectGuestReasons", () => {
  it("lists each inert reason once, skipping commentable and full-width rows", () => {
    const rows: (GuestRowResolution | undefined)[] = [
      undefined,
      { commentable: true, chunkId: "c1", side: "new", line: 10 },
      { commentable: false, reason: GuestRowReasons.REMOVED_BEFORE_HEAD },
      { commentable: false, reason: GuestRowReasons.NOT_IN_PR_DIFF },
      { commentable: false, reason: GuestRowReasons.REMOVED_BEFORE_HEAD },
    ];

    expect(collectGuestReasons(rows)).toEqual([
      GuestRowReasons.REMOVED_BEFORE_HEAD,
      GuestRowReasons.NOT_IN_PR_DIFF,
    ]);
  });
});
