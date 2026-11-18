// @vitest-environment jsdom
import type { ConcernRollup } from "brief-core/types";
import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";

import {
  computeCardMinHeight,
  computeConcernShares,
  computeStackOffset,
  labelConcernShares,
  writeCardMinHeight,
  writeStackOffset,
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
  it("ends the card with the summary when the stack is empty", () => {
    expect(
      computeCardMinHeight({
        summaryHeight: 300,
        rowGap: 24,
        collapsedStackHeight: 0,
      }),
    ).toBe(300);
  });

  it("adds the row gap and the closed stack to the summary", () => {
    expect(
      computeCardMinHeight({
        summaryHeight: 300,
        rowGap: 24,
        collapsedStackHeight: 104,
      }),
    ).toBe(428);
  });
});

describe("writeCardMinHeight", () => {
  it("writes the height in pixels", () => {
    const grid = document.createElement("div");

    writeCardMinHeight(grid, 428);

    expect(grid.style.getPropertyValue("--masthead-card-min")).toBe("428px");
  });

  it("skips the write when the height did not change", () => {
    const grid = document.createElement("div");
    writeCardMinHeight(grid, 428);
    const setProperty = vi.spyOn(grid.style, "setProperty");

    writeCardMinHeight(grid, 428);

    expect(setProperty).not.toHaveBeenCalled();
  });
});

describe("computeStackOffset", () => {
  const resting = { summaryHeight: 60, rowGap: 24, collapsedStackHeight: 244 };

  it("is what the card runs past the summary, gap and closed stack", () => {
    expect(computeStackOffset({ ...resting, cardHeight: 410 })).toBe(82);
  });

  it("is zero for a card no taller than the resting column", () => {
    expect(computeStackOffset({ ...resting, cardHeight: 328 })).toBe(0);
    expect(computeStackOffset({ ...resting, cardHeight: 0 })).toBe(0);
  });

  it("is zero for an empty stack", () => {
    const tallCard = { summaryHeight: 60, rowGap: 24, cardHeight: 410 };

    expect(computeStackOffset({ ...tallCard, collapsedStackHeight: 0 })).toBe(
      0,
    );
  });
});

describe("writeStackOffset", () => {
  it("writes the offset in pixels and skips an unchanged one", () => {
    const grid = document.createElement("div");

    writeStackOffset(grid, 82);
    expect(grid.style.getPropertyValue("--masthead-stack-offset")).toBe("82px");

    const setProperty = vi.spyOn(grid.style, "setProperty");
    writeStackOffset(grid, 82);
    expect(setProperty).not.toHaveBeenCalled();
  });
});

describe("labelConcernShares", () => {
  it("names concerns by their vocabulary and the remainder unattributed", () => {
    const shares = computeConcernShares(
      [{ concern: "doc", added: 5, deleted: 5 }],
      { added: 10, deleted: 0 },
    );
    const t = ((key: string) => `t:${key}`) as unknown as TFunction;

    expect(
      labelConcernShares(t, shares).map(({ key, concern, name }) => ({
        key,
        concern,
        name,
      })),
    ).toEqual([
      { key: "doc", concern: "doc", name: "t:brief.concern.doc" },
      {
        key: "unattributed-remainder",
        concern: undefined,
        name: "t:brief.unattributed.label",
      },
    ]);
  });
});
