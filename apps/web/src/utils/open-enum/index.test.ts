import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import type { Equals } from "types/utils";

import { buildOpenEnumSchema, readVocabularyMember } from ".";
import { UnknownValues, type UnknownValue } from "./types";

const Colours = { RED: "red", BLUE: "blue" } as const;
const colourSchema = buildOpenEnumSchema(Colours);
const paintSchema = z.object({ colour: colourSchema });

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

  it("fails an object whose field holds null or a number", () => {
    expect(paintSchema.safeParse({ colour: null }).success).toBe(false);
    expect(paintSchema.safeParse({ colour: 5 }).success).toBe(false);
  });

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

  it("types the output as the members plus the sentinel", () => {
    const pinned: Equals<
      z.output<typeof colourSchema>,
      "red" | "blue" | UnknownValue
    > = true;
    expect(pinned).toBe(true);
  });
});

describe("readVocabularyMember", () => {
  const members: ReadonlySet<string> = new Set(Object.values(Colours));

  it("reads a member as itself", () => {
    expect(readVocabularyMember(members, "blue")).toBe(Colours.BLUE);
  });

  it("reads a string outside the members as unknown", () => {
    expect(readVocabularyMember(members, "green")).toBe(UnknownValues.UNKNOWN);
  });

  it.each([[5], [null], [undefined], [{}]])(
    "passes a non-string %j through unchanged",
    (value) => {
      expect(readVocabularyMember(members, value)).toBe(value);
    },
  );
});
