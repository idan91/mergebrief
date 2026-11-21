import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { buildTolerantListSchema } from "./tolerant-list";

const NamesSchema = buildTolerantListSchema(z.string());

describe("buildTolerantListSchema", () => {
  it("keeps every entry its item schema reads", () => {
    expect(NamesSchema.parse(["a", "b"])).toEqual(["a", "b"]);
  });

  it("drops an entry its item schema rejects and keeps the rest", () => {
    expect(NamesSchema.parse(["a", 7, "b"])).toEqual(["a", "b"]);
  });

  it("still fails a value that is not a list", () => {
    expect(NamesSchema.safeParse("a").success).toBe(false);
  });
});
