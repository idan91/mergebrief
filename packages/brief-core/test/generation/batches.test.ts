import { describe, expect, it } from "vitest";
import type { HunkId } from "../../src/diff/hunk-index/types";
import {
  planDetailBatches,
  splitBatch,
} from "../../src/generation/multi-call/batches";
import {
  DETAIL_BATCH_MAX_DIFF_TOKENS,
  DETAIL_BATCH_MAX_HUNKS,
} from "../../src/generation/multi-call/consts";
import type { DetailBatch } from "../../src/generation/multi-call/types";

/** `count` hunk ids of file `f<file>`, numbered from 1. */
function makeHunks(file: number, count: number): HunkId[] {
  return Array.from(
    { length: count },
    (_, index): HunkId => `f${file}h${index + 1}`,
  );
}

function stubTokens(
  hunkIds: readonly HunkId[],
  tokens: number,
): Map<HunkId, number> {
  return new Map(hunkIds.map((hunkId) => [hunkId, tokens]));
}

function sumTokens(batch: DetailBatch, tokens: ReadonlyMap<HunkId, number>) {
  const hunkIds = batch.parts.flatMap((part) => part.hunkIds);
  return hunkIds.reduce((sum, hunkId) => sum + (tokens.get(hunkId) ?? 0), 0);
}

function readShape(batches: readonly DetailBatch[]): string[] {
  return batches.map((batch) =>
    batch.parts
      .map((part) => `${part.groupId}:${part.hunkIds.length}`)
      .join("+"),
  );
}

describe("planDetailBatches", () => {
  it("packs whole groups in reading order while a batch fits", () => {
    const batches = planDetailBatches({
      groupIds: ["g2", "g1", "g3"],
      hunkTokens: new Map(),
      hunksByGroup: new Map([
        ["g1", makeHunks(1, 4)],
        ["g2", makeHunks(2, 3)],
        ["g3", makeHunks(3, 5)],
      ]),
      maxHunks: 8,
    });

    expect(readShape(batches)).toEqual(["g2:3+g1:4", "g3:5"]);
    expect(batches.map((batch) => batch.index)).toEqual([0, 1]);
    expect(batches.map((batch) => batch.hunkCount)).toEqual([7, 5]);
  });

  it("reads 80 hunks as the limit", () => {
    const batches = planDetailBatches({
      groupIds: ["g1", "g2"],
      hunkTokens: new Map(),
      hunksByGroup: new Map([
        ["g1", makeHunks(1, DETAIL_BATCH_MAX_HUNKS)],
        ["g2", makeHunks(2, 1)],
      ]),
    });

    expect(readShape(batches)).toEqual(["g1:80", "g2:1"]);
  });

  it("an oversized group gets its own batches split by file under its id", () => {
    const batches = planDetailBatches({
      groupIds: ["g1", "g2"],
      hunkTokens: new Map(),
      hunksByGroup: new Map([
        ["g1", [...makeHunks(1, 3), ...makeHunks(2, 3), ...makeHunks(3, 2)]],
        ["g2", makeHunks(4, 1)],
      ]),
      maxHunks: 5,
    });

    expect(readShape(batches)).toEqual(["g1:3", "g1:5", "g2:1"]);
    expect(batches[1]?.parts[0]?.hunkIds).toEqual([
      ...makeHunks(2, 3),
      ...makeHunks(3, 2),
    ]);
  });

  it("a file over the limit is cut into runs of the limit", () => {
    const batches = planDetailBatches({
      groupIds: ["g1"],
      hunkTokens: new Map(),
      hunksByGroup: new Map([["g1", makeHunks(1, 11)]]),
      maxHunks: 4,
    });

    expect(readShape(batches)).toEqual(["g1:4", "g1:4", "g1:3"]);
  });

  it("a group with no hunks of its own takes no batch", () => {
    const batches = planDetailBatches({
      groupIds: ["g1", "g2"],
      hunkTokens: new Map(),
      hunksByGroup: new Map([["g2", makeHunks(1, 2)]]),
    });

    expect(readShape(batches)).toEqual(["g2:2"]);
  });

  it("an oversized group never shares a batch with its neighbours", () => {
    const batches = planDetailBatches({
      groupIds: ["g1", "g2", "g3"],
      hunkTokens: new Map(),
      hunksByGroup: new Map([
        ["g1", makeHunks(1, 1)],
        ["g2", makeHunks(2, 6)],
        ["g3", makeHunks(3, 1)],
      ]),
      maxHunks: 4,
    });

    expect(readShape(batches)).toEqual(["g1:1", "g2:4", "g2:2", "g3:1"]);
  });

  it("closes a batch before its diff passes the token budget", () => {
    const hunkTokens = new Map([
      ...stubTokens(makeHunks(1, 2), 60),
      ...stubTokens(makeHunks(2, 1), 50),
    ]);
    const batches = planDetailBatches({
      groupIds: ["g1", "g2"],
      hunksByGroup: new Map([
        ["g1", makeHunks(1, 2)],
        ["g2", makeHunks(2, 1)],
      ]),
      hunkTokens,
      maxTokens: 150,
    });

    expect(readShape(batches)).toEqual(["g1:2", "g2:1"]);
  });

  it("splits a group over the token budget by file under its id", () => {
    const hunkTokens = new Map([
      ...stubTokens(makeHunks(1, 2), 60),
      ...stubTokens(makeHunks(2, 1), 100),
    ]);
    const batches = planDetailBatches({
      groupIds: ["g1"],
      hunksByGroup: new Map([["g1", [...makeHunks(1, 2), ...makeHunks(2, 1)]]]),
      hunkTokens,
      maxTokens: 150,
    });

    expect(readShape(batches)).toEqual(["g1:2", "g1:1"]);
  });

  it("gives a hunk over the token budget a batch of its own", () => {
    const hunkTokens = new Map<HunkId, number>([
      ["f1h1", 10],
      ["f1h2", 500],
      ["f1h3", 10],
    ]);
    const batches = planDetailBatches({
      groupIds: ["g1"],
      hunksByGroup: new Map([["g1", makeHunks(1, 3)]]),
      hunkTokens,
      maxTokens: 100,
    });

    expect(batches.map((batch) => batch.parts[0]?.hunkIds)).toEqual([
      ["f1h1"],
      ["f1h2"],
      ["f1h3"],
    ]);
  });

  it("keeps every batch of a few large files under the default budget", () => {
    const hunkIds = Array.from(
      { length: 60 },
      (_, index): HunkId => `f${index + 1}h1`,
    );
    const hunkTokens = stubTokens(hunkIds, DETAIL_BATCH_MAX_DIFF_TOKENS / 25);
    const batches = planDetailBatches({
      groupIds: ["g1"],
      hunksByGroup: new Map([["g1", hunkIds]]),
      hunkTokens,
    });

    expect(readShape(batches)).toEqual(["g1:25", "g1:25", "g1:10"]);
    const budgets = batches.map((batch) => sumTokens(batch, hunkTokens));
    expect(
      budgets.every((tokens) => tokens <= DETAIL_BATCH_MAX_DIFF_TOKENS),
    ).toBe(true);
  });
});

describe("splitBatch", () => {
  it("splits a batch of several parts at the hunk midpoint", () => {
    const [batch] = planDetailBatches({
      groupIds: ["g1", "g2", "g3"],
      hunkTokens: new Map(),
      hunksByGroup: new Map([
        ["g1", makeHunks(1, 3)],
        ["g2", makeHunks(2, 2)],
        ["g3", makeHunks(3, 3)],
      ]),
    });

    const halves = splitBatch(batch!)!;

    expect(readShape(halves)).toEqual(["g1:3+g2:1", "g2:1+g3:3"]);
    expect(halves.map((half) => half.half)).toEqual([1, 2]);
    expect(halves.every((half) => half.index === 0)).toBe(true);
  });

  it("never leaves a half empty when the first parts hold most hunks", () => {
    const [batch] = planDetailBatches({
      groupIds: ["g1", "g2", "g3"],
      hunkTokens: new Map(),
      hunksByGroup: new Map([
        ["g1", makeHunks(1, 1)],
        ["g2", makeHunks(2, 1)],
        ["g3", makeHunks(3, 6)],
      ]),
    });

    const halves = splitBatch(batch!)!;

    expect(readShape(halves)).toEqual(["g1:1+g2:1+g3:2", "g3:4"]);
  });

  it.each([
    ["a large middle part", [10, 60, 10], ["g1:10+g2:30", "g2:30+g3:10"]],
    ["a large last part", [1, 79], ["g1:1+g2:39", "g2:40"]],
    ["a large first part", [79, 1], ["g1:40", "g1:39+g2:1"]],
  ])("halves a cut batch evenly past %s", (_label, sizes, shape) => {
    const groupIds = sizes.map((_size, index) => `g${index + 1}`);
    const [batch] = planDetailBatches({
      groupIds,
      hunkTokens: new Map(),
      hunksByGroup: new Map(
        sizes.map((size, index) => [
          `g${index + 1}`,
          makeHunks(index + 1, size),
        ]),
      ),
    });

    const halves = splitBatch(batch!)!;

    expect(batch?.parts).toHaveLength(sizes.length);
    expect(readShape(halves)).toEqual(shape);
    expect(halves.map((half) => half.hunkCount)).toEqual([40, 40]);
  });

  it("splits a one-part batch inside the part, never inside a hunk", () => {
    const [batch] = planDetailBatches({
      groupIds: ["g1"],
      hunkTokens: new Map(),
      hunksByGroup: new Map([["g1", makeHunks(1, 5)]]),
    });

    const halves = splitBatch(batch!)!;

    expect(halves.map((half) => half.parts[0]?.hunkIds)).toEqual([
      ["f1h1", "f1h2", "f1h3"],
      ["f1h4", "f1h5"],
    ]);
    expect(halves.map((half) => half.hunkCount)).toEqual([3, 2]);
  });

  it("keeps an oversized group's id on both halves", () => {
    const [batch] = planDetailBatches({
      groupIds: ["g1"],
      hunkTokens: new Map(),
      hunksByGroup: new Map([["g1", makeHunks(1, 6)]]),
      maxHunks: 4,
    });

    const halves = splitBatch(batch!)!;

    expect(
      halves.map((half) => half.parts.map((part) => part.groupId)),
    ).toEqual([["g1"], ["g1"]]);
  });

  it("has no halves for a batch of one hunk", () => {
    const [batch] = planDetailBatches({
      groupIds: ["g1"],
      hunkTokens: new Map(),
      hunksByGroup: new Map([["g1", makeHunks(1, 1)]]),
    });

    expect(splitBatch(batch!)).toBeUndefined();
  });
});
