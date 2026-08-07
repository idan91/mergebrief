import { describe, expect, it } from "vitest";
import {
  GroupVerdicts,
  partitionGroups,
  type PartitionInput,
} from "../../src/diff/touched";
import type { RevisionChangeFile } from "../../src/diff/revchanges";

/**
 * The touched-ness predicate (BRIEF-143 PR 2): previous-brief groups ×
 * incremental-diff evidence → frozen | re-look per group. Conservative by
 * construction: a group is frozen ONLY when every one of its files is
 * positively confirmed untouched; renames, binaries, mode changes, missing
 * compare data, or a possibly-truncated compare file list all demote to
 * re-look.
 */

function changed(file: string): RevisionChangeFile {
  return {
    file,
    addedRanges: [{ start: 1, end: 2 }],
    removedRanges: [{ start: 1, end: 1 }],
  };
}

function input(overrides: Partial<PartitionInput>): PartitionInput {
  return {
    previousGroups: [
      { id: "g1", files: ["src/a.ts"] },
      { id: "g2", files: ["src/b.ts", "src/c.ts"] },
    ],
    incrementalFiles: [],
    compareFiles: [],
    compareComplete: true,
    ...overrides,
  };
}

function verdictOf(
  result: ReturnType<typeof partitionGroups>,
  id: string,
): string | undefined {
  return result.find((entry) => entry.id === id)?.verdict;
}

describe("partitionGroups", () => {
  it("freezes every group when the incremental diff touches nothing", () => {
    const result = partitionGroups(input({}));
    expect(verdictOf(result, "g1")).toBe(GroupVerdicts.FROZEN);
    expect(verdictOf(result, "g2")).toBe(GroupVerdicts.FROZEN);
  });

  it("re-looks exactly the groups whose files carry incremental hunks", () => {
    const result = partitionGroups(
      input({
        incrementalFiles: [changed("src/b.ts")],
        compareFiles: [{ file: "src/b.ts", status: "modified" }],
      }),
    );
    expect(verdictOf(result, "g1")).toBe(GroupVerdicts.FROZEN);
    expect(verdictOf(result, "g2")).toBe(GroupVerdicts.RE_LOOK);
  });

  it("a compare entry without hunks (binary / mode-only) still re-looks its group", () => {
    const result = partitionGroups(
      input({
        // No parsed ranges — the raw diff shows nothing for a binary blob.
        compareFiles: [{ file: "src/a.ts", status: "modified" }],
      }),
    );
    expect(verdictOf(result, "g1")).toBe(GroupVerdicts.RE_LOOK);
    expect(verdictOf(result, "g2")).toBe(GroupVerdicts.FROZEN);
  });

  it("a rename re-looks the group owning the OLD path via previousFile", () => {
    const result = partitionGroups(
      input({
        compareFiles: [
          { file: "src/a2.ts", status: "renamed", previousFile: "src/a.ts" },
        ],
      }),
    );
    expect(verdictOf(result, "g1")).toBe(GroupVerdicts.RE_LOOK);
    expect(verdictOf(result, "g2")).toBe(GroupVerdicts.FROZEN);
  });

  it("an added file touches no previous group", () => {
    const result = partitionGroups(
      input({
        incrementalFiles: [changed("src/new.ts")],
        compareFiles: [{ file: "src/new.ts", status: "added" }],
      }),
    );
    expect(verdictOf(result, "g1")).toBe(GroupVerdicts.FROZEN);
    expect(verdictOf(result, "g2")).toBe(GroupVerdicts.FROZEN);
  });

  it("missing compare metadata re-looks everything (nothing is confirmable)", () => {
    const result = partitionGroups(input({ compareFiles: undefined }));
    expect(verdictOf(result, "g1")).toBe(GroupVerdicts.RE_LOOK);
    expect(verdictOf(result, "g2")).toBe(GroupVerdicts.RE_LOOK);
  });

  it("a possibly-truncated compare file list re-looks everything", () => {
    const result = partitionGroups(input({ compareComplete: false }));
    expect(verdictOf(result, "g1")).toBe(GroupVerdicts.RE_LOOK);
    expect(verdictOf(result, "g2")).toBe(GroupVerdicts.RE_LOOK);
  });

  it("an unrecognized compare status is conservative — touched", () => {
    const result = partitionGroups(
      input({
        compareFiles: [{ file: "src/c.ts", status: "quantum-entangled" }],
      }),
    );
    expect(verdictOf(result, "g2")).toBe(GroupVerdicts.RE_LOOK);
  });

  it("preserves previous-group order and reports a reason for every re-look", () => {
    const result = partitionGroups(
      input({
        incrementalFiles: [changed("src/a.ts"), changed("src/b.ts")],
        compareFiles: [
          { file: "src/a.ts", status: "modified" },
          { file: "src/b.ts", status: "modified" },
        ],
      }),
    );
    expect(result.map((entry) => entry.id)).toEqual(["g1", "g2"]);
    for (const entry of result) {
      expect(entry.verdict).toBe(GroupVerdicts.RE_LOOK);
      expect(entry.reason).toBeTruthy();
    }
  });

  it("frozen entries carry no reason", () => {
    const result = partitionGroups(input({}));
    for (const entry of result) {
      expect(entry.reason).toBeUndefined();
    }
  });
});
