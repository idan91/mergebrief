import { describe, expect, it } from "vitest";
import { countSplitRows } from "../../../src/diff/chunk-layout";
import { makeAdd, makeCtx, makeDel, makeHunk } from "./helpers";

describe("countSplitRows", () => {
  it("zips a deletion run with the additions after it", () => {
    const diff = [
      makeHunk(1, 1),
      makeCtx(1, 1),
      makeDel(2),
      makeDel(3),
      makeAdd(2),
      makeAdd(3),
      makeAdd(4),
      { kind: "note" as const, content: "\\ No newline at end of file" },
    ];

    expect(countSplitRows(diff)).toBe(6);
  });

  it("counts an addition run that follows no deletion as its own rows", () => {
    expect(countSplitRows([makeAdd(1), makeCtx(1, 2), makeDel(2)])).toBe(3);
  });

  it("counts nothing for no rows", () => {
    expect(countSplitRows([])).toBe(0);
  });
});
