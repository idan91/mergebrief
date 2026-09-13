import { describe, expect, it } from "vitest";

import type { Disposition } from "@web/features/review/session";
import type { RiskFlag } from "../../../../../../utils/viewModel";
import {
  capitalizeSentence,
  groupFlagsByFile,
  pickPathJumpChunkId,
} from "./utils";

function flag(
  id: string,
  file: string,
  chunkId: string,
  attr: RiskFlag["attr"],
): RiskFlag {
  return {
    id,
    attr,
    chunkId,
    file,
    groupId: "g1",
    source: "built-in",
    deEmphasized: false,
  };
}

const DISMISSED: Disposition = { kind: "dismissed", reason: "not this time" };
const ADDRESSED: Disposition = { kind: "addressed" };

describe("groupFlagsByFile", () => {
  it("keeps one row per file in first-chunk appearance order", () => {
    const flags = [
      flag("b-1", "src/b.ts", "c-b", "no-tests"),
      flag("a-1", "src/a.ts", "c-a", "dense-logic"),
    ];
    const rows = groupFlagsByFile(flags, {}, ["src/a.ts", "src/b.ts"]);
    expect(rows.map((row) => row.file)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("merges two chunks of the same path into one row", () => {
    const flags = [
      flag("c1-1", "src/same.ts", "c1", "no-tests"),
      flag("c2-1", "src/same.ts", "c2", "dense-logic"),
    ];
    const rows = groupFlagsByFile(flags, {}, ["src/same.ts", "src/same.ts"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.flags.map((entry) => entry.id)).toEqual(["c1-1", "c2-1"]);
  });

  it("splits open flags from resolved flags on the same file", () => {
    const flags = [
      flag("open-1", "src/a.ts", "c1", "no-tests"),
      flag("done-1", "src/a.ts", "c1", "dense-logic"),
    ];
    const rows = groupFlagsByFile(flags, { "done-1": DISMISSED }, ["src/a.ts"]);
    expect(rows[0]?.openFlags.map((entry) => entry.id)).toEqual(["open-1"]);
    expect(rows[0]?.resolvedFlags.map((entry) => entry.id)).toEqual(["done-1"]);
  });
});

describe("pickPathJumpChunkId", () => {
  it("jumps to the first open flag chunk else the first flag", () => {
    const row = groupFlagsByFile(
      [
        flag("d1", "src/a.ts", "old", "no-tests"),
        flag("o1", "src/a.ts", "fresh", "dense-logic"),
      ],
      { d1: ADDRESSED },
      ["src/a.ts"],
    )[0];
    if (row === undefined) throw new Error("expected a file row");
    expect(pickPathJumpChunkId(row)).toBe("fresh");
    const resolvedOnly = groupFlagsByFile(
      [flag("d1", "src/a.ts", "old", "no-tests")],
      { d1: ADDRESSED },
      ["src/a.ts"],
    )[0];
    if (resolvedOnly === undefined) throw new Error("expected a file row");
    expect(pickPathJumpChunkId(resolvedOnly)).toBe("old");
  });
});

describe("capitalizeSentence", () => {
  it("uppercases only the first character", () => {
    expect(capitalizeSentence("comment says the param is optional")).toBe(
      "Comment says the param is optional",
    );
    expect(capitalizeSentence("Already capped")).toBe("Already capped");
    expect(capitalizeSentence("")).toBe("");
  });
});
