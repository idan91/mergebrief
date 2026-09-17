import {
  type DiffLine,
  DiffLineKinds,
  DiffRowOrigins,
} from "@web/utils/diffTokens/types";
import { describe, expect, it } from "vitest";

import {
  EXPAND_STEP,
  findExpansionGaps,
  formatExpansionKey,
  resolveExpansionWindow,
  spliceAllExpandedRows,
  spliceExpandedRows,
} from "./expandRows";
import { ExpansionDirections, type ExpansionGap } from "../types";

function makeHunk(oldStart: number, newStart: number): DiffLine {
  return {
    kind: DiffLineKinds.HUNK,
    content: `@@ -${String(oldStart)},4 +${String(newStart)},4 @@`,
  };
}

function makeCtx(oldLine: number, newLine: number): DiffLine {
  return {
    kind: DiffLineKinds.CTX,
    content: `ctx ${String(newLine)}`,
    oldLine,
    newLine,
  };
}

function makeAdd(newLine: number): DiffLine {
  return {
    kind: DiffLineKinds.ADD,
    content: `add ${String(newLine)}`,
    newLine,
  };
}

function makeDel(oldLine: number): DiffLine {
  return {
    kind: DiffLineKinds.DEL,
    content: `del ${String(oldLine)}`,
    oldLine,
  };
}

function makeLines(from: number, to: number): string[] {
  const lines: string[] = [];
  for (let line = from; line <= to; line += 1)
    lines.push(`file ${String(line)}`);
  return lines;
}

describe("findExpansionGaps", () => {
  it("reports the hole above the first line of the file", () => {
    const diff = [makeHunk(10, 10), makeCtx(10, 10), makeAdd(11)];

    const gaps = findExpansionGaps(diff);

    expect(gaps).toEqual([
      {
        edge: { rowIndex: 1, direction: ExpansionDirections.UP },
        from: 1,
        to: 9,
        offset: 0,
      },
      {
        edge: { rowIndex: 3, direction: ExpansionDirections.DOWN },
        from: 12,
        offset: -1,
      },
    ]);
  });

  it("reports both edges of a hole between two hunks", () => {
    const diff = [
      makeHunk(1, 1),
      makeCtx(1, 1),
      makeDel(2),
      makeHunk(40, 39),
      makeCtx(40, 39),
    ];

    const gaps = findExpansionGaps(diff);
    const inner = gaps.filter((gap) => gap.from === 2);

    expect(inner).toEqual([
      {
        edge: { rowIndex: 3, direction: ExpansionDirections.DOWN },
        from: 2,
        to: 38,
        offset: 1,
      },
      {
        edge: { rowIndex: 4, direction: ExpansionDirections.UP },
        from: 2,
        to: 38,
        offset: 1,
      },
    ]);
  });

  it("reports a sliced hole that carries no hunk header", () => {
    const diff = [makeHunk(1, 1), makeCtx(1, 1), makeCtx(9, 9)];

    const gaps = findExpansionGaps(diff);

    expect(gaps.filter((gap) => gap.from === 2)).toEqual([
      {
        edge: { rowIndex: 2, direction: ExpansionDirections.DOWN },
        from: 2,
        to: 8,
        offset: 0,
      },
      {
        edge: { rowIndex: 2, direction: ExpansionDirections.UP },
        from: 2,
        to: 8,
        offset: 0,
      },
    ]);
  });

  it("reads the offset off a first row that carries no header", () => {
    const diff = [makeCtx(10, 5), makeAdd(6)];

    const gaps = findExpansionGaps(diff);

    expect(gaps[0]).toEqual({
      edge: { rowIndex: 0, direction: ExpansionDirections.UP },
      from: 1,
      to: 4,
      offset: 5,
    });
  });

  it("re-derives the offset across a hole inside one hunk", () => {
    const diff = [
      makeHunk(1, 1),
      makeCtx(1, 1),
      makeAdd(2),
      makeCtx(2, 3),
      makeCtx(46, 50),
      makeAdd(51),
    ];

    const gaps = findExpansionGaps(diff);
    const inner = gaps.filter((gap) => gap.from === 4);

    expect(inner).toEqual([
      {
        edge: { rowIndex: 4, direction: ExpansionDirections.DOWN },
        from: 4,
        to: 49,
        offset: -1,
      },
      {
        edge: { rowIndex: 4, direction: ExpansionDirections.UP },
        from: 4,
        to: 49,
        offset: -4,
      },
    ]);
  });

  it("reads the trailing offset off the last row that states one", () => {
    const diff = [makeCtx(10, 5), makeAdd(6)];

    expect(findExpansionGaps(diff).at(-1)).toEqual({
      edge: { rowIndex: 2, direction: ExpansionDirections.DOWN },
      from: 7,
      offset: 4,
    });
  });

  it("finds only the tail edge in a contiguous chunk", () => {
    const diff = [makeCtx(1, 1), makeAdd(2), makeCtx(2, 3)];

    expect(findExpansionGaps(diff)).toEqual([
      {
        edge: { rowIndex: 3, direction: ExpansionDirections.DOWN },
        from: 4,
        offset: -1,
      },
    ]);
  });
});

describe("findExpansionGaps at a run that opens on deletions", () => {
  it("puts the up edge before a deletion under the header, offset walked", () => {
    const diff = [
      makeCtx(2, 3),
      makeHunk(46, 50),
      makeDel(46),
      makeCtx(47, 50),
    ];
    const gaps = findExpansionGaps(diff);
    const up = gaps.find(
      (gap) => gap.edge.direction === ExpansionDirections.UP && gap.from === 4,
    );

    expect(up).toMatchObject({
      edge: { rowIndex: 2 },
      from: 4,
      to: 49,
      offset: -4,
    });
    const rows = spliceExpandedRows({
      diff,
      gap: up!,
      range: { from: 45, to: 49, lines: makeLines(45, 49) },
    });
    expect(rows[2]).toMatchObject({
      kind: "ctx",
      origin: "expanded",
      oldLine: 41,
      newLine: 45,
    });
    expect(rows[7]).toMatchObject({ kind: "del", oldLine: 46 });
  });

  it("keeps both edges above a deletion that belongs to the run below", () => {
    const diff = [makeCtx(2, 3), makeDel(46), makeCtx(47, 50)];
    const gaps = findExpansionGaps(diff).filter((gap) => gap.from === 4);

    expect(gaps.map((gap) => gap.edge.rowIndex)).toEqual([1, 1]);
    expect(gaps.map((gap) => gap.offset)).toEqual([-1, -4]);
  });

  it("opens the first gap at row zero when the file starts on deletions", () => {
    const diff = [
      makeDel(46),
      makeDel(47),
      makeAdd(50),
      makeAdd(51),
      makeCtx(48, 52),
    ];
    const first = findExpansionGaps(diff)[0];

    expect(first).toMatchObject({
      edge: { rowIndex: 0, direction: "up" },
      from: 1,
      to: 49,
      offset: -4,
    });
  });
});

describe("spliceAllExpandedRows on one hole from both sides", () => {
  const diff = [makeCtx(3, 3), makeHunk(50, 50), makeCtx(50, 50)];

  function readsFor(downTo: number) {
    const [down, up] = findExpansionGaps(diff).filter((gap) => gap.from === 4);
    return [
      {
        gap: down!,
        range: { from: 4, to: downTo, lines: makeLines(4, downTo) },
      },
      { gap: up!, range: { from: 30, to: 49, lines: makeLines(30, 49) } },
    ];
  }

  it("drops the header when the two reads meet", () => {
    const rows = spliceAllExpandedRows(diff, readsFor(29));

    expect(rows.filter((row) => row.kind === DiffLineKinds.HUNK)).toHaveLength(
      0,
    );
    expect(
      rows.filter((row) => row.origin === DiffRowOrigins.EXPANDED),
    ).toHaveLength(46);
  });

  it("renders an overlap once", () => {
    const rows = spliceAllExpandedRows(diff, readsFor(43));
    const shown = rows
      .filter((row) => row.origin === DiffRowOrigins.EXPANDED)
      .map((row) => row.newLine);

    expect(shown).toEqual(
      Array.from({ length: 46 }, (_unused, offset) => 4 + offset),
    );
    expect(rows.filter((row) => row.kind === DiffLineKinds.HUNK)).toHaveLength(
      0,
    );
  });
});

describe("spliceAllExpandedRows on a hole whose run below opens on deletions", () => {
  const diff = [makeCtx(2, 3), makeHunk(46, 50), makeDel(46), makeCtx(47, 50)];

  function readsFor(downTo: number) {
    const [down, up] = findExpansionGaps(diff).filter((gap) => gap.from === 4);
    return [
      {
        gap: down!,
        range: { from: 4, to: downTo, lines: makeLines(4, downTo) },
      },
      { gap: up!, range: { from: 30, to: 49, lines: makeLines(30, 49) } },
    ];
  }

  function readOldLine(rows: readonly DiffLine[], newLine: number) {
    return rows.find((row) => row.newLine === newLine)?.oldLine;
  }

  it("numbers each side of the meet by its own offset", () => {
    const rows = spliceAllExpandedRows(diff, readsFor(29));

    expect(rows.filter((row) => row.kind === DiffLineKinds.HUNK)).toHaveLength(
      0,
    );
    expect(readOldLine(rows, 29)).toBe(28);
    expect(readOldLine(rows, 30)).toBe(26);
    expect(readOldLine(rows, 49)).toBe(45);
    expect(rows.at(-2)).toMatchObject({ kind: "del", oldLine: 46 });
  });

  it("numbers an overlap by the downward offset up to where it ends", () => {
    const rows = spliceAllExpandedRows(diff, readsFor(43));

    expect(readOldLine(rows, 43)).toBe(42);
    expect(readOldLine(rows, 44)).toBe(40);
    expect(
      rows.filter((row) => row.origin === DiffRowOrigins.EXPANDED),
    ).toHaveLength(46);
  });
});

describe("formatExpansionKey", () => {
  it("keys an edge by chunk, row and direction", () => {
    const key = formatExpansionKey("chunk-1", {
      rowIndex: 4,
      direction: ExpansionDirections.UP,
    });

    expect(key).toBe("chunk-1:4:up");
  });
});

describe("resolveExpansionWindow", () => {
  const gap: ExpansionGap = {
    edge: { rowIndex: 3, direction: ExpansionDirections.DOWN },
    from: 10,
    to: 200,
    offset: 0,
  };

  it("takes one step down from the top of the hole", () => {
    expect(resolveExpansionWindow({ gap })).toEqual({ from: 10, to: 29 });
  });

  it("continues below what is already expanded", () => {
    expect(
      resolveExpansionWindow({ gap, expanded: { start: 10, end: 29 } }),
    ).toEqual({ from: 30, to: 49 });
  });

  it("takes the whole remainder when a step or less is left", () => {
    const short = { ...gap, to: 25 };

    expect(resolveExpansionWindow({ gap: short })).toEqual({
      from: 10,
      to: 25,
    });
  });

  it("takes one step up from the bottom of the hole", () => {
    const upward: ExpansionGap = {
      edge: { rowIndex: 3, direction: ExpansionDirections.UP },
      from: 10,
      to: 200,
      offset: 0,
    };

    expect(resolveExpansionWindow({ gap: upward })).toEqual({
      from: 181,
      to: 200,
    });
  });

  it("stops where the other edge of the hole already read", () => {
    expect(
      resolveExpansionWindow({ gap, blocked: [{ start: 15, end: 40 }] }),
    ).toEqual({ from: 10, to: 14 });
  });

  it("refuses an edge whose every line the other edge read", () => {
    expect(
      resolveExpansionWindow({ gap, blocked: [{ start: 1, end: 400 }] }),
    ).toBeUndefined();
  });

  it("refuses an edge with nothing left to read", () => {
    const short = { ...gap, to: 12 };

    expect(
      resolveExpansionWindow({ gap: short, expanded: { start: 10, end: 12 } }),
    ).toBeUndefined();
  });

  it("caps a step at twenty lines", () => {
    expect(EXPAND_STEP).toBe(20);
  });
});

describe("spliceExpandedRows", () => {
  it("inserts numbered expanded rows below the edge", () => {
    const diff = [
      makeHunk(1, 1),
      makeCtx(1, 1),
      makeHunk(40, 40),
      makeCtx(40, 40),
    ];
    const gap: ExpansionGap = {
      edge: { rowIndex: 2, direction: ExpansionDirections.DOWN },
      from: 2,
      to: 39,
      offset: 0,
    };

    const rows = spliceExpandedRows({
      diff,
      gap,
      range: { from: 2, to: 4, lines: makeLines(2, 4) },
    });

    expect(rows.slice(2, 5)).toEqual([
      {
        kind: DiffLineKinds.CTX,
        origin: DiffRowOrigins.EXPANDED,
        content: "file 2",
        oldLine: 2,
        newLine: 2,
      },
      {
        kind: DiffLineKinds.CTX,
        origin: DiffRowOrigins.EXPANDED,
        content: "file 3",
        oldLine: 3,
        newLine: 3,
      },
      {
        kind: DiffLineKinds.CTX,
        origin: DiffRowOrigins.EXPANDED,
        content: "file 4",
        oldLine: 4,
        newLine: 4,
      },
    ]);
    expect(rows).toHaveLength(7);
  });

  it("derives old numbers from the edge offset", () => {
    const diff = [
      makeHunk(1, 1),
      makeCtx(1, 1),
      makeHunk(38, 40),
      makeCtx(38, 40),
    ];
    const gap: ExpansionGap = {
      edge: { rowIndex: 3, direction: ExpansionDirections.UP },
      from: 2,
      to: 39,
      offset: -2,
    };

    const rows = spliceExpandedRows({
      diff,
      gap,
      range: { from: 38, to: 39, lines: makeLines(38, 39) },
    });

    expect(rows.slice(3, 5).map((row) => [row.oldLine, row.newLine])).toEqual([
      [36, 38],
      [37, 39],
    ]);
  });

  it("keeps rows the chunk already carries out of the splice", () => {
    const diff = [makeCtx(1, 1), makeCtx(9, 9)];
    const gap: ExpansionGap = {
      edge: { rowIndex: 1, direction: ExpansionDirections.DOWN },
      from: 2,
      to: 8,
      offset: 0,
    };

    const rows = spliceExpandedRows({
      diff,
      gap,
      range: { from: 1, to: 9, lines: makeLines(1, 9) },
    });

    expect(rows.map((row) => row.newLine)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("drops the header of a hole that closes to zero", () => {
    const diff = [makeHunk(1, 1), makeCtx(1, 1), makeHunk(3, 3), makeCtx(3, 3)];
    const gap: ExpansionGap = {
      edge: { rowIndex: 2, direction: ExpansionDirections.DOWN },
      from: 2,
      to: 2,
      offset: 0,
    };

    const rows = spliceExpandedRows({
      diff,
      gap,
      range: { from: 2, to: 2, lines: makeLines(2, 2) },
    });

    expect(rows.map((row) => [row.kind, row.origin])).toEqual([
      [DiffLineKinds.HUNK, undefined],
      [DiffLineKinds.CTX, undefined],
      [DiffLineKinds.CTX, DiffRowOrigins.EXPANDED],
      [DiffLineKinds.CTX, undefined],
    ]);
  });

  it("keeps the header while the hole stays open", () => {
    const diff = [makeHunk(1, 1), makeCtx(1, 1), makeHunk(9, 9), makeCtx(9, 9)];
    const gap: ExpansionGap = {
      edge: { rowIndex: 2, direction: ExpansionDirections.DOWN },
      from: 2,
      to: 8,
      offset: 0,
    };

    const rows = spliceExpandedRows({
      diff,
      gap,
      range: { from: 2, to: 3, lines: makeLines(2, 3) },
    });

    expect(rows.some((row) => row.kind === DiffLineKinds.HUNK)).toBe(true);
  });

  it("returns the same rows when the range holds nothing new", () => {
    const diff = [makeCtx(1, 1), makeCtx(9, 9)];
    const gap: ExpansionGap = {
      edge: { rowIndex: 1, direction: ExpansionDirections.DOWN },
      from: 2,
      to: 8,
      offset: 0,
    };

    const rows = spliceExpandedRows({
      diff,
      gap,
      range: { from: 20, to: 21, lines: makeLines(20, 21) },
    });

    expect(rows).toEqual(diff);
  });

  it("walks through lines another chunk of the file renders", () => {
    const diff = [makeCtx(1, 1), makeCtx(30, 30)];
    const gap: ExpansionGap = {
      edge: { rowIndex: 1, direction: ExpansionDirections.DOWN },
      from: 2,
      to: 29,
      offset: 0,
    };

    const rows = spliceExpandedRows({
      diff,
      gap,
      range: { from: 2, to: 21, lines: makeLines(2, 21) },
    });

    expect(rows.map((row) => row.newLine)).toEqual([
      1,
      ...Array.from({ length: 20 }, (_unused, offset) => 2 + offset),
      30,
    ]);
  });
});

describe("spliceAllExpandedRows", () => {
  it("applies a top and a lower edge without corrupting either index", () => {
    const diff = [makeCtx(1, 1), makeCtx(9, 9), makeCtx(30, 30)];
    const rows = spliceAllExpandedRows(diff, [
      {
        gap: {
          edge: { rowIndex: 1, direction: ExpansionDirections.DOWN },
          from: 2,
          to: 8,
          offset: 0,
        },
        range: { from: 2, to: 3, lines: makeLines(2, 3) },
      },
      {
        gap: {
          edge: { rowIndex: 2, direction: ExpansionDirections.DOWN },
          from: 10,
          to: 29,
          offset: 0,
        },
        range: { from: 10, to: 11, lines: makeLines(10, 11) },
      },
    ]);

    expect(rows.map((row) => row.newLine)).toEqual([1, 2, 3, 9, 10, 11, 30]);
  });

  it("leaves the downward rows above the upward ones at a shared index", () => {
    const diff = [makeCtx(1, 1), makeCtx(30, 30)];
    const rows = spliceAllExpandedRows(diff, [
      {
        gap: {
          edge: { rowIndex: 1, direction: ExpansionDirections.UP },
          from: 2,
          to: 29,
          offset: 0,
        },
        range: { from: 28, to: 29, lines: makeLines(28, 29) },
      },
      {
        gap: {
          edge: { rowIndex: 1, direction: ExpansionDirections.DOWN },
          from: 2,
          to: 29,
          offset: 0,
        },
        range: { from: 2, to: 3, lines: makeLines(2, 3) },
      },
    ]);

    expect(rows.map((row) => row.newLine)).toEqual([1, 2, 3, 28, 29, 30]);
  });
});

describe("spliceExpandedRows from the file's own rows", () => {
  const fileRows: DiffLine[] = [
    makeHunk(20, 20),
    makeCtx(20, 20),
    makeDel(21),
    makeAdd(21),
    makeCtx(22, 22),
    makeHunk(40, 40),
    makeCtx(40, 40),
    makeAdd(41),
    makeCtx(41, 42),
  ];
  const diff = [
    makeHunk(40, 40),
    makeCtx(40, 40),
    makeAdd(41),
    makeCtx(41, 42),
  ];

  it("splices a hunk's add and del rows where the window overlaps it", () => {
    const gap = findExpansionGaps(diff).find(
      (candidate) => candidate.from === 1,
    )!;
    const rows = spliceExpandedRows({
      diff,
      gap,
      range: { from: 20, to: 39, lines: makeLines(20, 39) },
      fileRows,
    });

    expect(rows.slice(1, 5)).toEqual([
      { ...makeCtx(20, 20), origin: DiffRowOrigins.EXPANDED },
      { ...makeDel(21), origin: DiffRowOrigins.EXPANDED },
      { ...makeAdd(21), origin: DiffRowOrigins.EXPANDED },
      { ...makeCtx(22, 22), origin: DiffRowOrigins.EXPANDED },
    ]);
    expect(rows[5]).toMatchObject({
      kind: "ctx",
      oldLine: 23,
      newLine: 23,
      content: "file 23",
    });
    expect(rows).toHaveLength(diff.length + 21);
  });

  it("still drops the seam header when the reads meet through a hunk", () => {
    const gaps = findExpansionGaps(diff);
    const up = gaps.find((gap) => gap.from === 1)!;
    const rows = spliceAllExpandedRows(diff, [
      {
        gap: up,
        range: { from: 1, to: 39, lines: makeLines(1, 39) },
        fileRows,
      },
    ]);

    expect(rows.filter((row) => row.kind === DiffLineKinds.HUNK)).toHaveLength(
      0,
    );
    expect(rows.filter((row) => row.kind === DiffLineKinds.DEL)).toHaveLength(
      1,
    );
  });

  it("takes each side of a hole through a hunk once and drops the seam", () => {
    const gaps = findExpansionGaps(diff);
    const up = gaps.find((gap) => gap.from === 1)!;
    const hole = [makeHunk(1, 1), makeCtx(1, 1), ...diff];
    const holeGaps = findExpansionGaps(hole);
    const down = holeGaps.find(
      (gap) =>
        gap.from === 2 && gap.edge.direction === ExpansionDirections.DOWN,
    )!;
    const upEdge = holeGaps.find(
      (gap) => gap.from === 2 && gap.edge.direction === ExpansionDirections.UP,
    )!;
    const rows = spliceAllExpandedRows(hole, [
      {
        gap: down,
        range: { from: 2, to: 21, lines: makeLines(2, 21) },
        fileRows,
      },
      {
        gap: upEdge,
        range: { from: 22, to: 39, lines: makeLines(22, 39) },
        fileRows,
      },
    ]);

    expect(up.from).toBe(1);
    expect(rows.filter((row) => row.kind === DiffLineKinds.HUNK)).toHaveLength(
      1,
    );
    expect(rows.filter((row) => row.kind === DiffLineKinds.DEL)).toHaveLength(
      1,
    );
    expect(
      rows.filter((row) => row.origin === DiffRowOrigins.EXPANDED),
    ).toHaveLength(39);
  });
});
