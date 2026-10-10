import type { DiffLine } from "@web/utils/diffTokens/types";
import { describe, expect, it } from "vitest";

import { resolveFileStatus } from "./file-status";

function stubRows(header: string): DiffLine[] {
  return [
    { kind: "hunk", content: header },
    { kind: "add", content: "a", newLine: 1 },
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
    const rows: DiffLine[] = [{ kind: "add", content: "a", newLine: 1 }];

    expect(resolveFileStatus(rows)).toBeUndefined();
  });
});
