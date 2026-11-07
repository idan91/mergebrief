import { describe, expect, it } from "vitest";

import type { GroupView } from "../../../../model/utils/view-model";
import { findChunkById } from "./utils";

const groups = [
  { id: "g1", chunks: [{ id: "c1" }, { id: "c2" }] },
  { id: "g2", chunks: [{ id: "c3" }] },
] as unknown as GroupView[];

describe("findChunkById", () => {
  it("finds a chunk in any group", () => {
    expect(findChunkById(groups, "c3")?.id).toBe("c3");
    expect(findChunkById(groups, "c1")?.id).toBe("c1");
  });

  it("answers nothing for no id or an id off the page", () => {
    expect(findChunkById(groups, undefined)).toBeUndefined();
    expect(findChunkById(groups, "gone")).toBeUndefined();
  });
});
