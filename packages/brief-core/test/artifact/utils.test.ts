import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { parseStored } from "../../src/artifact/utils";

describe("parseStored", () => {
  it("rethrows an error that is not a stack overflow", () => {
    const schema = z.string().refine(() => {
      throw new TypeError("programmer error");
    });

    expect(() => parseStored(schema, "body")).toThrow(TypeError);
  });
});
