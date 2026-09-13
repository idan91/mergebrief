import { describe, expect, it } from "vitest";

import type { DiffLine } from "@web/utils/diffTokens/types";
import { hasPairedSides } from "./utils";

const ctx: DiffLine = { kind: "ctx", content: "a", oldLine: 1, newLine: 1 };
const add: DiffLine = { kind: "add", content: "b", newLine: 2 };
const del: DiffLine = { kind: "del", content: "c", oldLine: 2 };

describe("hasPairedSides", () => {
  it("pairs only a diff with both additions and deletions", () => {
    expect(hasPairedSides([ctx, del, add])).toBe(true);
    expect(hasPairedSides([ctx, add])).toBe(false);
    expect(hasPairedSides([ctx, del])).toBe(false);
    expect(hasPairedSides([ctx])).toBe(false);
  });
});
