import { describe, expect, it } from "vitest";
import { RowRunKinds, readRowRuns } from "../../../src/diff/chunk-layout";

describe("readRowRuns", () => {
  it("reads every run in order with its length", () => {
    expect(readRowRuns("h1c12r3a2n1e1")).toEqual([
      { kind: RowRunKinds.HUNK, length: 1 },
      { kind: RowRunKinds.CONTEXT, length: 12 },
      { kind: RowRunKinds.REMOVED, length: 3 },
      { kind: RowRunKinds.ADDED, length: 2 },
      { kind: RowRunKinds.NOTE, length: 1 },
      { kind: RowRunKinds.EXPAND, length: 1 },
    ]);
  });

  it("reads empty row runs as no runs", () => {
    expect(readRowRuns("")).toEqual([]);
  });
});
