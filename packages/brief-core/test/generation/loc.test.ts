import { describe, expect, it } from "vitest";
import {
  buildConcernView,
  countLines,
  crossCheckFileTotals,
  deriveChunkLoc,
  deriveUnattributed,
  detectChunkOverlaps,
  diffLocTotals,
  intersectRanges,
  subtractRanges,
  unattributedTotals,
} from "../../src/generation/loc";
import type { RevisionChangeFile } from "../../src/diff/revchanges";
import type { LineRange } from "../../src/types";

function ranges(...pairs: [number, number][]): LineRange[] {
  return pairs.map(([start, end]) => ({ start, end }));
}

function changed(
  file: string,
  addedRanges: LineRange[],
  removedRanges: LineRange[] = [],
): RevisionChangeFile {
  return { file, addedRanges, removedRanges };
}

describe("countLines", () => {
  it("returns 0 for no ranges", () => {
    expect(countLines([])).toBe(0);
  });

  it("counts inclusive range lengths", () => {
    expect(countLines(ranges([5, 5]))).toBe(1);
    expect(countLines(ranges([1, 3], [10, 14]))).toBe(8);
  });

  it("does not double-count overlapping input ranges", () => {
    expect(countLines(ranges([1, 5], [3, 8]))).toBe(8);
  });
});

describe("intersectRanges", () => {
  it("returns empty for disjoint ranges", () => {
    expect(intersectRanges(ranges([1, 3]), ranges([5, 9]))).toEqual([]);
  });

  it("clips a partial overlap", () => {
    expect(intersectRanges(ranges([1, 10]), ranges([5, 20]))).toEqual(
      ranges([5, 10]),
    );
  });

  it("keeps a fully contained range", () => {
    expect(intersectRanges(ranges([1, 100]), ranges([40, 42]))).toEqual(
      ranges([40, 42]),
    );
  });

  it("handles unsorted, fragmented inputs", () => {
    expect(
      intersectRanges(ranges([20, 30], [1, 5]), ranges([4, 22], [28, 40])),
    ).toEqual(ranges([4, 5], [20, 22], [28, 30]));
  });

  it("merges adjacent input fragments before intersecting", () => {
    // [1,2]+[3,4] behave as [1,4]
    expect(intersectRanges(ranges([1, 2], [3, 4]), ranges([2, 3]))).toEqual(
      ranges([2, 3]),
    );
  });
});

describe("subtractRanges", () => {
  it("returns the minuend when nothing overlaps", () => {
    expect(subtractRanges(ranges([1, 5]), ranges([10, 20]))).toEqual(
      ranges([1, 5]),
    );
  });

  it("removes a fully covering range", () => {
    expect(subtractRanges(ranges([3, 7]), ranges([1, 10]))).toEqual([]);
  });

  it("splits a range around a hole", () => {
    expect(subtractRanges(ranges([1, 10]), ranges([4, 6]))).toEqual(
      ranges([1, 3], [7, 10]),
    );
  });

  it("clips edges", () => {
    expect(subtractRanges(ranges([1, 10]), ranges([1, 2], [9, 12]))).toEqual(
      ranges([3, 8]),
    );
  });
});

describe("deriveChunkLoc", () => {
  const files = [
    changed("a.ts", ranges([10, 19], [30, 34]), ranges([5, 8])),
    changed("b.ts", ranges([1, 4])),
  ];

  it("counts the intersection of chunk ranges with the diff's changed lines", () => {
    const [chunk] = deriveChunkLoc(
      [
        {
          file: "a.ts",
          addedRanges: ranges([10, 14]),
          removedRanges: ranges([5, 6]),
        },
      ],
      files,
    );
    expect(chunk?.loc).toEqual({ added: 5, deleted: 2 });
  });

  it("clamps ranges that spill past the changed lines", () => {
    const [chunk] = deriveChunkLoc(
      [{ file: "a.ts", addedRanges: ranges([15, 40]), removedRanges: [] }],
      files,
    );
    // [15,40] ∩ ([10,19] ∪ [30,34]) = [15,19] + [30,34]
    expect(chunk?.loc).toEqual({ added: 10, deleted: 0 });
  });

  it("yields zero for a file absent from the diff", () => {
    const [chunk] = deriveChunkLoc(
      [
        {
          file: "ghost.ts",
          addedRanges: ranges([1, 5]),
          removedRanges: ranges([1, 5]),
        },
      ],
      files,
    );
    expect(chunk?.loc).toEqual({ added: 0, deleted: 0 });
  });

  it("preserves the chunk's other fields", () => {
    const [chunk] = deriveChunkLoc(
      [
        {
          id: "c1",
          file: "b.ts",
          addedRanges: ranges([1, 2]),
          removedRanges: [],
        },
      ],
      files,
    );
    expect(chunk).toMatchObject({ id: "c1", loc: { added: 2, deleted: 0 } });
  });
});

describe("deriveUnattributed", () => {
  const files = [
    changed("a.ts", ranges([10, 19]), ranges([5, 8])),
    changed("b.ts", ranges([1, 4])),
  ];

  it("returns empty when chunks cover every changed line", () => {
    expect(
      deriveUnattributed(
        [
          {
            file: "a.ts",
            addedRanges: ranges([10, 19]),
            removedRanges: ranges([5, 8]),
          },
          { file: "b.ts", addedRanges: ranges([1, 4]), removedRanges: [] },
        ],
        files,
      ),
    ).toEqual([]);
  });

  it("reports the per-file complement of the chunk union", () => {
    expect(
      deriveUnattributed(
        [
          { file: "a.ts", addedRanges: ranges([10, 12]), removedRanges: [] },
          { file: "b.ts", addedRanges: ranges([1, 4]), removedRanges: [] },
        ],
        files,
      ),
    ).toEqual([
      {
        file: "a.ts",
        addedRanges: ranges([13, 19]),
        removedRanges: ranges([5, 8]),
      },
    ]);
  });

  it("reports a wholly uncovered file", () => {
    expect(deriveUnattributed([], [changed("c.ts", ranges([1, 2]))])).toEqual([
      { file: "c.ts", addedRanges: ranges([1, 2]), removedRanges: [] },
    ]);
  });

  it("unions overlapping chunks before subtracting", () => {
    expect(
      deriveUnattributed(
        [
          { file: "b.ts", addedRanges: ranges([1, 2]), removedRanges: [] },
          { file: "b.ts", addedRanges: ranges([2, 4]), removedRanges: [] },
        ],
        [changed("b.ts", ranges([1, 4]))],
      ),
    ).toEqual([]);
  });

  it("ignores chunk ranges outside the changed lines", () => {
    expect(
      deriveUnattributed(
        [{ file: "b.ts", addedRanges: ranges([100, 200]), removedRanges: [] }],
        [changed("b.ts", ranges([1, 2]))],
      ),
    ).toEqual([
      { file: "b.ts", addedRanges: ranges([1, 2]), removedRanges: [] },
    ]);
  });
});

describe("unattributedTotals", () => {
  it("sums added and deleted lines across files", () => {
    expect(
      unattributedTotals([
        {
          file: "a.ts",
          addedRanges: ranges([1, 5]),
          removedRanges: ranges([2, 2]),
        },
        { file: "b.ts", addedRanges: ranges([10, 11]), removedRanges: [] },
      ]),
    ).toEqual({ added: 7, deleted: 1 });
  });
});

describe("normalize hardening through the public API", () => {
  it("drops inverted ranges instead of producing negative counts", () => {
    expect(countLines(ranges([5, 3]))).toBe(0);
  });

  it("keeps subtraction canonical when the subtrahend is inverted", () => {
    expect(subtractRanges(ranges([1, 10]), ranges([5, 3]))).toEqual(
      ranges([1, 10]),
    );
  });
});

describe("buildConcernView", () => {
  it("sums chunk loc per concern", () => {
    expect(
      buildConcernView([
        { concern: "implementation", loc: { added: 10, deleted: 2 } },
        { concern: "test", loc: { added: 5, deleted: 1 } },
        { concern: "implementation", loc: { added: 3, deleted: 4 } },
      ]),
    ).toEqual([
      { concern: "implementation", added: 13, deleted: 6 },
      { concern: "test", added: 5, deleted: 1 },
    ]);
  });

  it("emits one entry per concern present, in vocabulary order", () => {
    const view = buildConcernView([
      { concern: "doc", loc: { added: 1, deleted: 0 } },
      { concern: "implementation", loc: { added: 1, deleted: 0 } },
    ]);
    expect(view.map((v) => v.concern)).toEqual(["implementation", "doc"]);
  });

  it("returns empty for no chunks", () => {
    expect(buildConcernView([])).toEqual([]);
  });
});

describe("detectChunkOverlaps", () => {
  it("returns empty when chunks are disjoint", () => {
    expect(
      detectChunkOverlaps([
        {
          id: "c1",
          file: "a.ts",
          addedRanges: ranges([1, 5]),
          removedRanges: [],
        },
        {
          id: "c2",
          file: "a.ts",
          addedRanges: ranges([6, 9]),
          removedRanges: [],
        },
      ]),
    ).toEqual([]);
  });

  it("reports same-file added-side overlaps with both chunk ids", () => {
    const issues = detectChunkOverlaps([
      {
        id: "c1",
        file: "a.ts",
        addedRanges: ranges([1, 5]),
        removedRanges: [],
      },
      {
        id: "c2",
        file: "a.ts",
        addedRanges: ranges([4, 9]),
        removedRanges: [],
      },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("c1");
    expect(issues[0]).toContain("c2");
    expect(issues[0]).toContain("a.ts");
  });

  it("reports removed-side overlaps independently", () => {
    const issues = detectChunkOverlaps([
      {
        id: "c1",
        file: "a.ts",
        addedRanges: [],
        removedRanges: ranges([1, 5]),
      },
      {
        id: "c2",
        file: "a.ts",
        addedRanges: [],
        removedRanges: ranges([5, 6]),
      },
    ]);
    expect(issues).toHaveLength(1);
  });

  it("ignores overlaps across different files or sides", () => {
    expect(
      detectChunkOverlaps([
        {
          id: "c1",
          file: "a.ts",
          addedRanges: ranges([1, 5]),
          removedRanges: [],
        },
        {
          id: "c2",
          file: "b.ts",
          addedRanges: ranges([1, 5]),
          removedRanges: [],
        },
        {
          id: "c3",
          file: "a.ts",
          addedRanges: [],
          removedRanges: ranges([1, 5]),
        },
      ]),
    ).toEqual([]);
  });
});

describe("crossCheckFileTotals", () => {
  it("returns empty when derived totals match gh's per-file counts", () => {
    expect(
      crossCheckFileTotals(
        [changed("a.ts", ranges([1, 5]), ranges([3, 4]))],
        [{ path: "a.ts", additions: 5, deletions: 2 }],
      ),
    ).toEqual([]);
  });

  it("reports both numbers on a mismatch", () => {
    const issues = crossCheckFileTotals(
      [changed("a.ts", ranges([1, 5]))],
      [{ path: "a.ts", additions: 7, deletions: 0 }],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("a.ts");
    expect(issues[0]).toContain("5");
    expect(issues[0]).toContain("7");
  });

  it("treats a file missing from the diff as zero-derived", () => {
    const issues = crossCheckFileTotals(
      [],
      [{ path: "bin.png", additions: 3, deletions: 1 }],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("bin.png");
  });

  it("stays silent for a gh file with zero counts absent from the diff", () => {
    expect(
      crossCheckFileTotals(
        [],
        [{ path: "bin.png", additions: 0, deletions: 0 }],
      ),
    ).toEqual([]);
  });

  it("reports a diff file gh never listed", () => {
    const issues = crossCheckFileTotals([changed("a.ts", ranges([1, 2]))], []);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("a.ts");
  });
});

describe("diffLocTotals", () => {
  it("sums added and deleted separately across files", () => {
    expect(
      diffLocTotals([
        changed("a.ts", ranges([1, 5]), ranges([3, 4])),
        changed("b.ts", ranges([10, 10])),
      ]),
    ).toEqual({ added: 6, deleted: 2 });
  });
});
