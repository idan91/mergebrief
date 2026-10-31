import { describe, expect, it } from "vitest";
import { renumberGroupIds } from "../../src/generation/multi-call/renumber";
import { GroupingGenerationSchema } from "../../src/types";
import { grouping, makeGroup } from "./fixtures/multi-call-pr";

const withReferences = GroupingGenerationSchema.parse({
  ...grouping,
  intentCheck: {
    ...grouping.intentCheck,
    items: [
      {
        bucket: "accomplished",
        intent: "Refactor three modules",
        quote: "Touches three files",
        sourceUrl: "",
        groupIds: ["g1", "g3"],
        acknowledged: false,
      },
    ],
  },
});

describe("renumberGroupIds", () => {
  it("mints every id past the reserved ones and re-points each reference", () => {
    const renumbered = renumberGroupIds(withReferences, ["g1", "g2", "g4"]);

    expect(renumbered.changeGroups.map((group) => group.id)).toEqual([
      "g3",
      "g5",
      "g6",
    ]);
    expect(renumbered.hunkMap.map((entry) => entry.groupId)).toEqual([
      "g3",
      "g5",
      "g6",
    ]);
    expect(renumbered.readingOrder?.map((step) => step.groupId)).toEqual([
      "g5",
      "g3",
      "g6",
    ]);
    expect(renumbered.intentCheck.items[0]?.groupIds).toEqual(["g3", "g6"]);
  });

  it("leaves a reference to an unlisted group as written and mints around it", () => {
    const stray = GroupingGenerationSchema.parse({
      ...grouping,
      hunkMap: [...grouping.hunkMap, { groupId: "g4", hunks: ["f3"] }],
    });

    const renumbered = renumberGroupIds(stray, ["g1"]);

    expect(renumbered.hunkMap.at(-1)?.groupId).toBe("g4");
    expect(renumbered.changeGroups.map((group) => group.id)).toEqual([
      "g2",
      "g3",
      "g5",
    ]);
  });

  it("gives two groups sharing an id the same minted id", () => {
    const doubled = GroupingGenerationSchema.parse({
      ...grouping,
      changeGroups: [makeGroup("g1"), makeGroup("g1")],
      readingOrder: undefined,
    });

    const renumbered = renumberGroupIds(doubled, ["g1"]);

    expect(renumbered.changeGroups.map((group) => group.id)).toEqual([
      "g4",
      "g4",
    ]);
    expect(renumbered.readingOrder).toBeUndefined();
  });
});
