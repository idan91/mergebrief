import { describe, expect, it } from "vitest";

import { isChunkTokenizable } from "./utils";
import { CHUNK_ROW_CEILING } from "./consts";

describe("isChunkTokenizable", () => {
  it("admits a chunk sitting on the ceiling", () => {
    expect(isChunkTokenizable(CHUNK_ROW_CEILING)).toBe(true);
  });

  it("refuses a chunk one row above the ceiling", () => {
    expect(isChunkTokenizable(CHUNK_ROW_CEILING + 1)).toBe(false);
  });

  it("refuses a chunk with no rows", () => {
    expect(isChunkTokenizable(0)).toBe(false);
  });
});
