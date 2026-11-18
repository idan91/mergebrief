import { describe, expect, it } from "vitest";
import {
  ExpansionDirections,
  findExpansionGaps,
} from "../../../src/diff/chunk-layout";
import { makeAdd, makeCtx, makeDel, makeHunk } from "./helpers";

describe("findExpansionGaps", () => {
  it("reports the gap above the first line of the file", () => {
    const diff = [makeHunk(10, 10), makeCtx(10, 10), makeAdd(11)];

    const gaps = findExpansionGaps(diff);

    expect(gaps).toEqual([
      {
        edge: { rowIndex: 1, direction: ExpansionDirections.UP },
        start: 1,
        end: 9,
        offset: 0,
      },
      {
        edge: { rowIndex: 3, direction: ExpansionDirections.DOWN },
        start: 12,
        offset: -1,
      },
    ]);
  });

  it("reports both edges of a gap between two hunks", () => {
    const diff = [
      makeHunk(1, 1),
      makeCtx(1, 1),
      makeDel(2),
      makeHunk(40, 39),
      makeCtx(40, 39),
    ];

    const gaps = findExpansionGaps(diff);
    const inner = gaps.filter((gap) => gap.start === 2);

    expect(inner).toEqual([
      {
        edge: { rowIndex: 3, direction: ExpansionDirections.DOWN },
        start: 2,
        end: 38,
        offset: 1,
      },
      {
        edge: { rowIndex: 4, direction: ExpansionDirections.UP },
        start: 2,
        end: 38,
        offset: 1,
      },
    ]);
  });

  it("reports a sliced gap that carries no hunk header", () => {
    const diff = [makeHunk(1, 1), makeCtx(1, 1), makeCtx(9, 9)];

    const gaps = findExpansionGaps(diff);

    expect(gaps.filter((gap) => gap.start === 2)).toEqual([
      {
        edge: { rowIndex: 2, direction: ExpansionDirections.DOWN },
        start: 2,
        end: 8,
        offset: 0,
      },
      {
        edge: { rowIndex: 2, direction: ExpansionDirections.UP },
        start: 2,
        end: 8,
        offset: 0,
      },
    ]);
  });

  it("reads the offset off a first row that carries no header", () => {
    const diff = [makeCtx(10, 5), makeAdd(6)];

    const gaps = findExpansionGaps(diff);

    expect(gaps[0]).toEqual({
      edge: { rowIndex: 0, direction: ExpansionDirections.UP },
      start: 1,
      end: 4,
      offset: 5,
    });
  });

  it("re-derives the offset across a gap inside one hunk", () => {
    const diff = [
      makeHunk(1, 1),
      makeCtx(1, 1),
      makeAdd(2),
      makeCtx(2, 3),
      makeCtx(46, 50),
      makeAdd(51),
    ];

    const gaps = findExpansionGaps(diff);
    const inner = gaps.filter((gap) => gap.start === 4);

    expect(inner).toEqual([
      {
        edge: { rowIndex: 4, direction: ExpansionDirections.DOWN },
        start: 4,
        end: 49,
        offset: -1,
      },
      {
        edge: { rowIndex: 4, direction: ExpansionDirections.UP },
        start: 4,
        end: 49,
        offset: -4,
      },
    ]);
  });

  it("reads the trailing offset off the last row that states one", () => {
    const diff = [makeCtx(10, 5), makeAdd(6)];

    expect(findExpansionGaps(diff).at(-1)).toEqual({
      edge: { rowIndex: 2, direction: ExpansionDirections.DOWN },
      start: 7,
      offset: 4,
    });
  });

  it("finds only the tail edge in a contiguous chunk", () => {
    const diff = [makeCtx(1, 1), makeAdd(2), makeCtx(2, 3)];

    expect(findExpansionGaps(diff)).toEqual([
      {
        edge: { rowIndex: 3, direction: ExpansionDirections.DOWN },
        start: 4,
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

    const up = findExpansionGaps(diff).find(
      (gap) => gap.edge.direction === ExpansionDirections.UP && gap.start === 4,
    );

    expect(up).toEqual({
      edge: { rowIndex: 2, direction: ExpansionDirections.UP },
      start: 4,
      end: 49,
      offset: -4,
    });
  });

  it("keeps both edges above a deletion that belongs to the run below", () => {
    const diff = [makeCtx(2, 3), makeDel(46), makeCtx(47, 50)];

    const gaps = findExpansionGaps(diff).filter((gap) => gap.start === 4);

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

    expect(first).toEqual({
      edge: { rowIndex: 0, direction: ExpansionDirections.UP },
      start: 1,
      end: 49,
      offset: -4,
    });
  });
});
