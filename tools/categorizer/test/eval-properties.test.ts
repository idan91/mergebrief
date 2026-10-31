import { describe, expect, it } from "vitest";
import { scoreRuns, type EvalProperty } from "../eval/properties";
import { briefWithGroups } from "./eval-fixtures";

/**
 * Property engine: predicates over parsed Briefs, scored across runs.
 * A throwing predicate counts as a FAIL with a recorded note (a bad
 * property must be visible, never a crash or a silent pass).
 */

const atLeastTwoGroups: EvalProperty = {
  id: "at-least-two-groups",
  description: ">=2 change groups",
  check: (brief) => brief.changeGroups.length >= 2,
};

const throwing: EvalProperty = {
  id: "throws",
  description: "predicate blows up",
  check: () => {
    throw new Error("bad property");
  },
};

describe("scoreRuns", () => {
  it("counts passes per property across runs", () => {
    const result = scoreRuns(
      [atLeastTwoGroups],
      [briefWithGroups(1), briefWithGroups(2), briefWithGroups(3)],
    );
    expect(result.scores.get("at-least-two-groups")).toEqual({
      passes: 2,
      runs: 3,
    });
    expect(result.notes).toEqual([]);
  });

  it("treats a throwing predicate as a fail with a recorded note", () => {
    const result = scoreRuns([throwing], [briefWithGroups(2)]);
    expect(result.scores.get("throws")).toEqual({ passes: 0, runs: 1 });
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain("throws");
    expect(result.notes[0]).toContain("bad property");
  });

  it("hands every property the case's changed files", () => {
    const changedFiles = [
      {
        file: "src/a.ts",
        addedRanges: [{ start: 1, end: 2 }],
        removedRanges: [],
      },
    ];
    const seesChangedFiles: EvalProperty = {
      id: "sees-changed-files",
      description: "reads the case diff's changed files",
      check: (_brief, files) => files === changedFiles,
    };

    const result = scoreRuns(
      [seesChangedFiles],
      [briefWithGroups(1)],
      changedFiles,
    );

    expect(result.scores.get("sees-changed-files")).toEqual({
      passes: 1,
      runs: 1,
    });
  });

  it("rejects duplicate property ids loudly", () => {
    expect(() =>
      scoreRuns([atLeastTwoGroups, atLeastTwoGroups], [briefWithGroups(2)]),
    ).toThrow(/duplicate/i);
  });
});
