import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { enumPreservingJsonSchema } from "../src/validation/jsonSchema";

const RangeSchema = z.object({ start: z.number(), end: z.number() });
const StepSchema = z.object({ id: z.string() });

const ReusingSchema = z.object({
  first: RangeSchema,
  second: RangeSchema,
  steps: z.array(StepSchema).optional().describe("ordered steps"),
});

describe("enumPreservingJsonSchema defs", () => {
  it("keeps a reused subschema in $defs under a renumbered id", () => {
    const wire = enumPreservingJsonSchema(ReusingSchema);

    expect(wire["$defs"]).toEqual({ __schema0: expect.any(Object) });
    expect(wire["properties"]).toMatchObject({
      first: { $ref: "#/$defs/__schema0" },
      second: { $ref: "#/$defs/__schema0" },
    });
  });

  it("inlines a single-use subschema with the description beside its ref", () => {
    const wire = enumPreservingJsonSchema(ReusingSchema);

    expect(wire["properties"]).toMatchObject({
      steps: {
        type: "array",
        description: "ordered steps",
        items: { type: "object", required: ["id"] },
      },
    });
  });

  it("drops $defs when no subschema is reused", () => {
    const wire = enumPreservingJsonSchema(
      z.object({ steps: z.array(StepSchema).describe("ordered steps") }),
    );

    expect(wire["$defs"]).toBeUndefined();
  });
});
