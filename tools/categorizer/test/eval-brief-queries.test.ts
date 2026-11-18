import type { Brief } from "brief-core/types";
import { describe, expect, it } from "vitest";
import {
  chunksFor,
  dominantCategories,
  findGroupIdOwningAddedLine,
  fires,
  firstGroupIndex,
  groupIdsFor,
  orderedGroupIds,
} from "../eval/briefQueries";
import { briefWithGroups, makeBrief } from "./eval-fixtures";

function makeChunk(
  file: string,
  changeGroupId: string,
  addedRange: { start: number; end: number },
  riskSurface: string[] = [],
) {
  return {
    id: `${file}-${addedRange.start}`,
    changeGroupId,
    file,
    addedRanges: [addedRange],
    removedRanges: [],
    riskSurface,
  };
}

const QUERY_BRIEF = {
  ...briefWithGroups(3),
  chunks: [
    makeChunk("packages/a/src/one.ts", "g1", { start: 1, end: 5 }),
    makeChunk("packages/a/src/one.ts", "g2", { start: 10, end: 20 }, ["authz"]),
    makeChunk("packages/b/src/two.ts", "g2", { start: 1, end: 2 }),
  ],
} as unknown as Brief;

describe("chunk queries", () => {
  it("finds chunks by file suffix", () => {
    expect(chunksFor(QUERY_BRIEF, "src/one.ts")).toHaveLength(2);
    expect(chunksFor(QUERY_BRIEF, "src/none.ts")).toEqual([]);
  });

  it("dedupes the groups carrying a file's chunks", () => {
    expect(groupIdsFor(QUERY_BRIEF, "src/one.ts")).toEqual(["g1", "g2"]);
    expect(groupIdsFor(QUERY_BRIEF, "src/two.ts")).toEqual(["g2"]);
  });

  it("names the group owning an added line, its bounds included", () => {
    expect(findGroupIdOwningAddedLine(QUERY_BRIEF, "one.ts", 5)).toBe("g1");
    expect(findGroupIdOwningAddedLine(QUERY_BRIEF, "one.ts", 10)).toBe("g2");
    expect(
      findGroupIdOwningAddedLine(QUERY_BRIEF, "one.ts", 7),
    ).toBeUndefined();
  });
});

describe("fires", () => {
  it("looks across every chunk without a suffix", () => {
    expect(fires(QUERY_BRIEF, "authz" as never)).toBe(true);
    expect(fires(QUERY_BRIEF, "sql-injection" as never)).toBe(false);
  });

  it("looks only at the suffix's chunks with one", () => {
    expect(fires(QUERY_BRIEF, "authz" as never, "one.ts")).toBe(true);
    expect(fires(QUERY_BRIEF, "authz" as never, "two.ts")).toBe(false);
  });
});

describe("group order", () => {
  it("reads dominant categories in source order", () => {
    const groups = briefWithGroups(2).changeGroups.map((group, index) => ({
      ...group,
      dominantCategory: index === 0 ? "bugfix" : "new-feature",
    }));
    const brief = makeBrief({ changeGroups: groups } as Partial<Brief>);

    expect(dominantCategories(brief)).toEqual(["bugfix", "new-feature"]);
  });

  it("uses source order without a reading order", () => {
    expect(orderedGroupIds(briefWithGroups(2))).toEqual(["g1", "g2"]);
  });

  it("prefers the reading order when the brief has one", () => {
    const brief = makeBrief({
      ...briefWithGroups(2),
      readingOrder: [{ groupId: "g2" }, { groupId: "g1" }],
    } as Partial<Brief>);

    expect(orderedGroupIds(brief)).toEqual(["g2", "g1"]);
    expect(firstGroupIndex(brief, (id) => id === "g1")).toBe(1);
  });

  it("answers Infinity when no group is picked", () => {
    const index = firstGroupIndex(briefWithGroups(2), () => false);

    expect(index).toBe(Number.POSITIVE_INFINITY);
  });
});
