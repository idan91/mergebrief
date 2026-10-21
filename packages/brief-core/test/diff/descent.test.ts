import { describe, expect, it } from "vitest";
import { assignGroupIds } from "../../src/diff/descent";

/**
 * The id-descent matcher: generated (re-looked + new) groups
 * inherit previous group ids by file overlap: merge → dominant parent's id;
 * split → dominant child keeps it, the rest mint; unmatched → mint.
 * Deterministic and order-stable; never collides with reserved (frozen) ids.
 */

describe("assignGroupIds", () => {
  it("inherits the previous id on a 1:1 file match", () => {
    const ids = assignGroupIds({
      generated: [{ id: "tmp1", files: ["a.ts", "b.ts"] }],
      previous: [{ id: "g7", files: ["a.ts", "b.ts"] }],
      reservedIds: [],
    });
    expect(ids.get("tmp1")).toBe("g7");
  });

  it("mints for a group with no previous overlap, avoiding reserved ids", () => {
    const ids = assignGroupIds({
      generated: [{ id: "tmp1", files: ["new.ts"] }],
      previous: [{ id: "g1", files: ["a.ts"] }],
      reservedIds: ["g1", "g2"],
    });
    const minted = ids.get("tmp1");
    expect(minted).toBeDefined();
    expect(["g1", "g2"]).not.toContain(minted);
  });

  it("merge: a group spanning two parents takes the dominant parent's id", () => {
    const ids = assignGroupIds({
      generated: [{ id: "tmp1", files: ["a.ts", "b.ts", "c.ts"] }],
      previous: [
        { id: "gA", files: ["a.ts"] },
        { id: "gB", files: ["b.ts", "c.ts"] },
      ],
      reservedIds: [],
    });
    expect(ids.get("tmp1")).toBe("gB");
  });

  it("merge tie: the first previous group in input order wins", () => {
    const ids = assignGroupIds({
      generated: [{ id: "tmp1", files: ["a.ts", "b.ts"] }],
      previous: [
        { id: "gA", files: ["a.ts"] },
        { id: "gB", files: ["b.ts"] },
      ],
      reservedIds: [],
    });
    expect(ids.get("tmp1")).toBe("gA");
  });

  it("split: the dominant child keeps the parent id, the other mints", () => {
    const ids = assignGroupIds({
      generated: [
        { id: "tmp1", files: ["a.ts"] },
        { id: "tmp2", files: ["b.ts", "c.ts"] },
      ],
      previous: [{ id: "gP", files: ["a.ts", "b.ts", "c.ts"] }],
      reservedIds: [],
    });
    expect(ids.get("tmp2")).toBe("gP");
    expect(ids.get("tmp1")).toBeDefined();
    expect(ids.get("tmp1")).not.toBe("gP");
  });

  it("split tie: the first generated group in input order keeps the id", () => {
    const ids = assignGroupIds({
      generated: [
        { id: "tmp1", files: ["a.ts"] },
        { id: "tmp2", files: ["b.ts"] },
      ],
      previous: [{ id: "gP", files: ["a.ts", "b.ts"] }],
      reservedIds: [],
    });
    expect(ids.get("tmp1")).toBe("gP");
    expect(ids.get("tmp2")).not.toBe("gP");
  });

  it("assigns every generated group a unique id with no collisions anywhere", () => {
    const ids = assignGroupIds({
      generated: [
        { id: "tmp1", files: ["a.ts"] },
        { id: "tmp2", files: ["z1.ts"] },
        { id: "tmp3", files: ["z2.ts"] },
      ],
      previous: [{ id: "g1", files: ["a.ts"] }],
      reservedIds: ["g2", "g3"],
    });
    const assigned = [...ids.values()];
    expect(new Set(assigned).size).toBe(3);
    expect(assigned).toContain("g1");
    const minted = assigned.filter((id) => id !== "g1");
    expect(minted.filter((id) => ["g2", "g3"].includes(id))).toEqual([]);
  });
});
