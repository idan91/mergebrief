import { describe, expect, it } from "vitest";

import { ChunkPositionKinds } from "./types";
import { deriveChunkPosition, type ChunkPositionInput } from "./utils";

function makeInput(
  overrides: Partial<ChunkPositionInput> = {},
): ChunkPositionInput {
  return {
    chunkIds: ["c1", "c2", "c3"],
    activeChunkId: "c2",
    scope: "full",
    pastContentStart: true,
    ...overrides,
  };
}

describe("deriveChunkPosition", () => {
  it("counts the active chunk among the rendered chunks", () => {
    expect(deriveChunkPosition(makeInput())).toEqual({
      kind: ChunkPositionKinds.CHUNK,
      current: 2,
      total: 3,
    });
  });

  it("reads Overview before the first chunk, whatever the store says", () => {
    expect(deriveChunkPosition(makeInput({ pastContentStart: false }))).toEqual(
      { kind: ChunkPositionKinds.OVERVIEW },
    );
  });

  it("reads Overview while no chunk is active", () => {
    expect(
      deriveChunkPosition(makeInput({ activeChunkId: undefined })),
    ).toEqual({
      kind: ChunkPositionKinds.OVERVIEW,
    });
  });

  it("reads Overview when the active chunk is filtered out", () => {
    expect(deriveChunkPosition(makeInput({ chunkIds: ["c1", "c3"] }))).toEqual({
      kind: ChunkPositionKinds.OVERVIEW,
    });
  });

  it("names the Changes scope without a count, whatever the store says", () => {
    expect(deriveChunkPosition(makeInput({ scope: "changes" }))).toEqual({
      kind: ChunkPositionKinds.CHANGES,
    });
    expect(
      deriveChunkPosition(
        makeInput({ scope: "changes", activeChunkId: undefined }),
      ),
    ).toEqual({ kind: ChunkPositionKinds.CHANGES });
  });

  it("reads Overview in Changes-only before the first chunk", () => {
    expect(
      deriveChunkPosition(
        makeInput({ scope: "changes", pastContentStart: false }),
      ),
    ).toEqual({ kind: ChunkPositionKinds.OVERVIEW });
  });
});
