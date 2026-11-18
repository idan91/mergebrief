import { DiffLineKinds } from "types/diff-lines";
import { describe, expect, it } from "vitest";
import {
  resolveFileStatus,
  type ParsedDiffLine,
} from "../../../src/diff/chunk-layout";

function stubRows(header: string): ParsedDiffLine[] {
  return [
    { kind: DiffLineKinds.HUNK, content: header },
    { kind: DiffLineKinds.ADD, content: "a", newLine: 1 },
  ];
}

describe("resolveFileStatus", () => {
  it("reads a new file from a hunk that starts at zero on the old side", () => {
    expect(resolveFileStatus(stubRows("@@ -0,0 +1,3 @@"))).toBe("new");
  });

  it("reads a deleted file from a hunk that ends at zero on the new side", () => {
    expect(resolveFileStatus(stubRows("@@ -1,3 +0,0 @@"))).toBe("deleted");
  });

  it("reads nothing from an ordinary hunk", () => {
    expect(resolveFileStatus(stubRows("@@ -10,4 +10,5 @@"))).toBeUndefined();
  });

  it("reads nothing from a sliced chunk with no header", () => {
    const rows: ParsedDiffLine[] = [
      { kind: DiffLineKinds.ADD, content: "a", newLine: 1 },
    ];

    expect(resolveFileStatus(rows)).toBeUndefined();
  });
});
