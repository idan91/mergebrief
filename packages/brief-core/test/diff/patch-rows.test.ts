import { describe, expect, it } from "vitest";
import {
  isAddedRow,
  isRemovedRow,
  parsePatchRows,
} from "../../src/diff/patch-rows";

const patch = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -3,3 +3,4 @@ function head() {",
  " ctx",
  "-old",
  "+new1",
  "+new2",
  "",
  " tail",
  "\\ No newline at end of file",
  "@@ -20 +21,2 @@",
  "+late",
].join("\n");

describe("parsePatchRows", () => {
  it("numbers each row on the sides it exists on, per hunk", () => {
    const rows = parsePatchRows(patch);

    expect(rows).toEqual([
      { content: "ctx", oldLine: 3, newLine: 3, hunk: 0 },
      { content: "old", oldLine: 4, hunk: 0 },
      { content: "new1", newLine: 4, hunk: 0 },
      { content: "new2", newLine: 5, hunk: 0 },
      { content: "tail", oldLine: 5, newLine: 6, hunk: 0 },
      { content: "late", newLine: 21, hunk: 1 },
    ]);
  });

  it("tells added and removed rows apart from context", () => {
    const rows = parsePatchRows(patch);

    expect(rows.filter(isAddedRow).map((row) => row.content)).toEqual([
      "new1",
      "new2",
      "late",
    ]);
    expect(rows.filter(isRemovedRow).map((row) => row.content)).toEqual([
      "old",
    ]);
  });

  it("keeps the header lines out and reads nothing before the first hunk", () => {
    expect(parsePatchRows("--- a/x\n+++ b/x\n")).toEqual([]);
  });
});
