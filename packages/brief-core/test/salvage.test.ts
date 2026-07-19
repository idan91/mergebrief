import { describe, expect, it } from "vitest";
import { salvageDroppableEnums } from "generators";
import { BriefGenerationSchema } from "../src/types";

const DROPPABLE = new Set([
  "secondaryCategories",
  "uncertainBetween",
  "riskSurface",
  "riskNotes",
  "concernView",
]);

function validGeneration() {
  return {
    summary: "s",
    changeGroups: [
      {
        id: "g1",
        title: "t",
        summary: "g",
        dominantCategory: "bugfix",
        secondaryCategories: [],
        uncertain: false,
        uncertainBetween: [],
      },
    ],
    chunks: [
      {
        id: "c1",
        changeGroupId: "g1",
        file: "a.ts",
        concern: "implementation",
        role: "carrier",
        loc: { added: 1, deleted: 0 },
        addedRanges: [{ start: 5, end: 5 }],
        removedRanges: [],
        riskSurface: ["mutates-state"],
      },
    ],
    concernView: [{ concern: "implementation", added: 1, deleted: 0 }],
  };
}

describe("salvageDroppableEnums", () => {
  it("passes a valid payload through with no issues", () => {
    const result = salvageDroppableEnums(
      validGeneration(),
      BriefGenerationSchema,
      DROPPABLE,
    );
    expect(result).not.toBeNull();
    expect(result?.issues).toEqual([]);
  });

  it("drops an out-of-vocabulary secondaryCategories token and warns", () => {
    const raw = validGeneration();
    raw.changeGroups[0].secondaryCategories = [
      "logic-refactor",
      "refactor-everything",
    ] as never;
    const result = salvageDroppableEnums(raw, BriefGenerationSchema, DROPPABLE);
    expect(result).not.toBeNull();
    expect(result?.value.changeGroups[0].secondaryCategories).toEqual([
      "logic-refactor",
    ]);
    expect(
      result?.issues.some((i) => i.includes("refactor-everything")),
    ).toBe(true);
    // pure: the input payload is untouched
    expect(raw.changeGroups[0].secondaryCategories).toHaveLength(2);
  });

  it("drops multiple bad elements across fields in one payload", () => {
    const raw = validGeneration();
    raw.changeGroups[0].secondaryCategories = ["scary"] as never;
    raw.chunks[0].riskSurface = ["mutates-state", "spooky", "no-tests"] as never;
    const result = salvageDroppableEnums(raw, BriefGenerationSchema, DROPPABLE);
    expect(result).not.toBeNull();
    expect(result?.value.changeGroups[0].secondaryCategories).toEqual([]);
    expect(result?.value.chunks[0].riskSurface).toEqual([
      "mutates-state",
      "no-tests",
    ]);
    expect(result?.issues).toHaveLength(2);
  });

  it("drops a riskNotes entry whose nested attr is invalid", () => {
    const raw = validGeneration();
    Object.assign(raw.chunks[0], {
      riskNotes: [
        { attr: "mutates-state", note: "writes the cache" },
        { attr: "not-a-token", note: "bad" },
      ],
    });
    const result = salvageDroppableEnums(raw, BriefGenerationSchema, DROPPABLE);
    expect(result).not.toBeNull();
    expect(result?.value.chunks[0].riskNotes).toEqual([
      { attr: "mutates-state", note: "writes the cache" },
    ]);
  });

  it("refuses to salvage an invalid dominantCategory (not droppable)", () => {
    const raw = validGeneration();
    raw.changeGroups[0].dominantCategory = "refactor-everything" as never;
    expect(
      salvageDroppableEnums(raw, BriefGenerationSchema, DROPPABLE),
    ).toBeNull();
  });

  it("refuses to salvage a structurally broken payload", () => {
    expect(
      salvageDroppableEnums({ summary: 1 }, BriefGenerationSchema, DROPPABLE),
    ).toBeNull();
    expect(
      salvageDroppableEnums(undefined, BriefGenerationSchema, DROPPABLE),
    ).toBeNull();
  });

  it("drops several bad elements from the same array without index skew", () => {
    const raw = validGeneration();
    raw.chunks[0].riskSurface = [
      "bad-one",
      "mutates-state",
      "bad-two",
      "no-tests",
      "bad-three",
    ] as never;
    const result = salvageDroppableEnums(raw, BriefGenerationSchema, DROPPABLE);
    expect(result).not.toBeNull();
    expect(result?.value.chunks[0].riskSurface).toEqual([
      "mutates-state",
      "no-tests",
    ]);
  });
});
