import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import type { Equals } from "types/utils";

import { buildOpenEnumSchema } from ".";
import { UnknownValues, type UnknownValue } from "./types";

const Colours = { RED: "red", BLUE: "blue" } as const;
const colourSchema = buildOpenEnumSchema(Colours);
const paintSchema = z.object({ colour: colourSchema });

true satisfies Equals<
  z.output<typeof colourSchema>,
  "red" | "blue" | UnknownValue
>;

describe("buildOpenEnumSchema", () => {
  it("reads a member as itself", () => {
    expect(colourSchema.parse("red")).toBe(Colours.RED);
  });

  it("reads a string outside the vocabulary as unknown", () => {
    expect(colourSchema.parse("green")).toBe(UnknownValues.UNKNOWN);
  });

  it.each([[5], [null], [true], [{}], [[]]])(
    "fails a non-string %j",
    (value) => {
      expect(colourSchema.safeParse(value).success).toBe(false);
    },
  );

  it("keeps a required field required", () => {
    expect(paintSchema.safeParse({}).success).toBe(false);
    expect(paintSchema.safeParse({ colour: undefined }).success).toBe(false);
  });

  it("reads a bad value inside an object without failing the object", () => {
    expect(paintSchema.parse({ colour: "green" })).toEqual({
      colour: UnknownValues.UNKNOWN,
    });
  });

  it("reads a vocabulary that already names unknown without change", () => {
    const Codes = { TIMEOUT: "timeout", UNKNOWN: "unknown" } as const;
    const schema = buildOpenEnumSchema(Codes);

    expect(schema.parse("unknown")).toBe(Codes.UNKNOWN);
    expect(schema.parse("other")).toBe(UnknownValues.UNKNOWN);
  });
});
