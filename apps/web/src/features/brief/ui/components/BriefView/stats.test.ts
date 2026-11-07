import { describe, expect, it } from "vitest";

import type { Brief } from "../../../model/types";
import { buildBriefViewModel } from "../../../model/utils/view-model";
import { briefFixture } from "../../../test-utils";
import { deriveStatFigures, findCountedRemainder } from "./stats";

const TOTALS = { reviewed: 1, chunkTotal: 6, flagsResolved: 1, flagTotal: 3 };

/** A flagged remainder file, so the remainder group exists even with no changed line. */
function makeRemainderBrief(addedEnd: number | undefined): Brief {
  const addedRanges =
    addedEnd === undefined ? [] : [{ start: 1, end: addedEnd }];
  return {
    ...briefFixture,
    unattributed: [
      {
        file: ".npmrc",
        addedRanges,
        removedRanges: [],
        riskSurface: ["changes-package-source"],
      },
    ],
  };
}

describe("findCountedRemainder", () => {
  it("finds a remainder that holds changed lines", () => {
    const model = buildBriefViewModel(makeRemainderBrief(4));

    expect(findCountedRemainder(model)?.added).toBe(4);
  });

  it("skips a remainder with no changed line", () => {
    const model = buildBriefViewModel(makeRemainderBrief(undefined));

    expect(findCountedRemainder(model)).toBeUndefined();
  });

  it("finds nothing without a remainder", () => {
    expect(
      findCountedRemainder(buildBriefViewModel(briefFixture)),
    ).toBeUndefined();
  });
});

describe("deriveStatFigures", () => {
  it("prints read and resolved of the totals for a reviewer", () => {
    expect(deriveStatFigures(TOTALS, false)).toEqual({
      chunks: "1/6",
      flags: "1/3",
    });
  });

  it("prints the bare flag total on the viewer's own draft", () => {
    expect(deriveStatFigures(TOTALS, true)).toEqual({
      chunks: "1/6",
      flags: "3",
    });
  });
});
