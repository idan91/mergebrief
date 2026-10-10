import { describe, expect, it } from "vitest";

import { briefFixture } from "@web/features/brief/test-utils";
import { buildBriefViewModel } from "../../../../../model/utils/viewModel";
import { deriveChunkSteps } from "./utils";

const [group] = buildBriefViewModel(briefFixture).groups;
if (!group) {
  throw new Error("fixture has no groups");
}
const [chunkA, chunkB] = group.chunks;
if (!chunkA || !chunkB) {
  throw new Error("fixture group needs two chunks");
}
const groups = [
  group,
  { ...group, id: "g2", chunks: [{ ...chunkA, id: "chunk-c" }] },
];

describe("deriveChunkSteps", () => {
  it("has no previous step on the first chunk", () => {
    expect(deriveChunkSteps(groups, chunkA.id)).toEqual({
      next: { chunkId: chunkB.id, crossesGroup: false },
    });
  });

  it("marks a step into the next group", () => {
    expect(deriveChunkSteps(groups, chunkB.id).next).toEqual({
      chunkId: "chunk-c",
      crossesGroup: true,
    });
  });

  it("has no next step on the last chunk", () => {
    expect(deriveChunkSteps(groups, "chunk-c")).toEqual({
      previous: { chunkId: chunkB.id, crossesGroup: true },
    });
  });

  it("has no steps without an active chunk", () => {
    expect(deriveChunkSteps(groups, null)).toEqual({});
  });
});
