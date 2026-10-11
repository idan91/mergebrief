// @vitest-environment jsdom
import type { ConcernRollup } from "brief-core/types";
import { describe, expect, it, vi } from "vitest";

import {
  computeCardMinHeight,
  computeConcernShares,
  writeCardMinHeight,
} from "./utils";

const rollup: ConcernRollup[] = [
  { concern: "implementation", added: 412, deleted: 118 },
  { concern: "test", added: 186, deleted: 22 },
  { concern: "doc", added: 38, deleted: 4 },
];

describe("computeConcernShares", () => {
  it("computes shares of the attributed total", () => {
    const shares = computeConcernShares(rollup);
    expect(shares.map((share) => share.percent)).toEqual([68, 27, 5]);
    expect(shares[0]).toMatchObject({
      concern: "implementation",
      added: 412,
      deleted: 118,
    });
  });

  it("accumulates duplicate concern entries instead of dropping them", () => {
    const shares = computeConcernShares([
      { concern: "implementation", added: 10, deleted: 0 },
      { concern: "implementation", added: 90, deleted: 0 },
      { concern: "test", added: 10, deleted: 0 },
    ]);
    expect(shares).toEqual([
      {
        kind: "concern",
        concern: "implementation",
        added: 100,
        deleted: 0,
        percent: 91,
      },
      { kind: "concern", concern: "test", added: 10, deleted: 0, percent: 9 },
    ]);
  });

  it("apportions rounded percents to sum to exactly 100", () => {
    // Independently rounded this would show 49 + 22 + 30 = 101; largest
    // remainder drops test to its floor instead.
    const shares = computeConcernShares([
      { concern: "implementation", added: 423, deleted: 0 },
      { concern: "test", added: 187, deleted: 0 },
      { concern: "doc", added: 259, deleted: 0 },
    ]);
    expect(shares.map((share) => share.percent)).toEqual([49, 21, 30]);

    const thirds = computeConcernShares([
      { concern: "implementation", added: 1, deleted: 0 },
      { concern: "test", added: 1, deleted: 0 },
      { concern: "doc", added: 1, deleted: 0 },
    ]);
    expect(thirds.reduce((sum, share) => sum + share.percent, 0)).toBe(100);
  });

  it("survives an all-zero rollup without NaN", () => {
    const shares = computeConcernShares([
      { concern: "implementation", added: 0, deleted: 0 },
      { concern: "test", added: 0, deleted: 0 },
    ]);
    expect(shares.map((share) => share.percent)).toEqual([0, 0]);
  });

  it("appends a last remainder segment and apportions over the whole diff", () => {
    const shares = computeConcernShares(
      [
        { concern: "implementation", added: 50, deleted: 0 },
        { concern: "test", added: 50, deleted: 0 },
      ],
      { added: 25, deleted: 0 },
    );
    expect(shares.map((share) => share.percent)).toEqual([40, 40, 20]);
    expect(shares[2]).toEqual({
      kind: "unattributed-remainder",
      added: 25,
      deleted: 0,
      percent: 20,
    });
  });

  it("does not append a zero-line remainder", () => {
    const shares = computeConcernShares(rollup, { added: 0, deleted: 0 });
    expect(shares).toHaveLength(3);
    expect(shares.every((share) => share.kind === "concern")).toBe(true);
  });
});

describe("computeCardMinHeight", () => {
  it("holds the summary, the gap and the collapsed stack", () => {
    expect(
      computeCardMinHeight({
        summaryHeight: 300,
        rowGap: 24,
        collapsedStackHeight: 104,
      }),
    ).toBe(428);
  });

  it("ends the card with the summary when the stack is empty", () => {
    expect(
      computeCardMinHeight({
        summaryHeight: 300,
        rowGap: 24,
        collapsedStackHeight: 0,
      }),
    ).toBe(300);
  });

  it("leaves the card natural before the stack was measured closed", () => {
    expect(
      computeCardMinHeight({
        summaryHeight: 300,
        rowGap: 24,
        collapsedStackHeight: undefined,
      }),
    ).toBeUndefined();
  });
});

describe("writeCardMinHeight", () => {
  it("writes the height and clears it when the card goes natural", () => {
    const grid = document.createElement("div");

    writeCardMinHeight(grid, 428);
    expect(grid.style.getPropertyValue("--masthead-card-min")).toBe("428px");

    writeCardMinHeight(grid, undefined);
    expect(grid.style.getPropertyValue("--masthead-card-min")).toBe("");
  });

  it("skips the write when the height did not change", () => {
    const grid = document.createElement("div");
    writeCardMinHeight(grid, 428);
    const setProperty = vi.spyOn(grid.style, "setProperty");

    writeCardMinHeight(grid, 428);

    expect(setProperty).not.toHaveBeenCalled();
  });
});
