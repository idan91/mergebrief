import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import {
  enumPreservingOutputFormat,
  toStrictJsonSchema,
} from "../src/outputFormat";
import { BriefGenerationSchema, RiskSurfaceAttributes } from "../src/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Navigate to a required object child, failing loudly if the shape is wrong. */
function child(node: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = node[key];
  if (!isRecord(value)) throw new Error(`expected an object at "${key}"`);
  return value;
}

/** Every record node in the tree, for structural assertions. */
function nodes(root: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (!isRecord(n)) return;
    found.push(n);
    for (const value of Object.values(n)) visit(value);
  };
  visit(root);
  return found;
}

/** Every `enum` array anywhere in the tree. */
function allEnums(root: unknown): unknown[][] {
  return nodes(root)
    .map((n) => n["enum"])
    .filter((e): e is unknown[] => Array.isArray(e));
}

describe("enumPreservingOutputFormat — schema shape", () => {
  const ProbeSchema = z.object({
    category: z.enum(["alpha", "beta", "gamma"]),
    tags: z.array(z.enum(["red", "green", "blue"])),
    notes: z.array(z.object({ attr: z.enum(["x1", "x2"]), note: z.string() })),
  });

  it("preserves enum at all three positions (top-level, array item, object-in-array)", () => {
    const { schema } = enumPreservingOutputFormat(ProbeSchema);
    const props = child(schema, "properties");

    expect(child(props, "category")["enum"]).toEqual(["alpha", "beta", "gamma"]);
    expect(child(child(props, "tags"), "items")["enum"]).toEqual([
      "red",
      "green",
      "blue",
    ]);
    const notesItem = child(child(props, "notes"), "items");
    expect(child(child(notesItem, "properties"), "attr")["enum"]).toEqual([
      "x1",
      "x2",
    ]);
  });

  it("preserves enum inside $defs when zod reuses a schema (reused: ref)", () => {
    const shared = z.enum(["one", "two"]);
    const { schema } = enumPreservingOutputFormat(
      z.object({ a: shared, b: shared }),
    );
    // Reuse hoists the shared enum into $defs and references it twice.
    expect(isRecord(schema["$defs"])).toBe(true);
    expect(allEnums(schema)).toContainEqual(["one", "two"]);
  });

  it("forces additionalProperties:false on every object and carries required", () => {
    const { schema } = enumPreservingOutputFormat(ProbeSchema);
    const objectNodes = nodes(schema).filter((n) => n["type"] === "object");
    expect(objectNodes.length).toBeGreaterThan(0);
    for (const obj of objectNodes) {
      expect(obj["additionalProperties"]).toBe(false);
    }
    expect(schema["required"]).toEqual(["category", "tags", "notes"]);
  });
});

describe("toStrictJsonSchema — keyword handling", () => {
  it("carries const verbatim", () => {
    const out = toStrictJsonSchema({ type: "string", const: "fixed" });
    expect(out["const"]).toBe("fixed");
  });

  it("carries a supported string format, demotes an unsupported one", () => {
    const out = toStrictJsonSchema({
      type: "object",
      properties: {
        good: { type: "string", format: "uri" },
        bad: { type: "string", format: "phone" },
      },
      required: ["good", "bad"],
    });
    const props = child(out, "properties");
    expect(child(props, "good")["format"]).toBe("uri");

    const bad = child(props, "bad");
    expect(bad["format"]).toBeUndefined();
    expect(bad["description"]).toContain("phone");
  });

  it("demotes an unsupported keyword into description instead of emitting it", () => {
    const out = toStrictJsonSchema({
      type: "number",
      minimum: 3,
    });
    expect(out["minimum"]).toBeUndefined();
    expect(String(out["description"])).toContain("minimum");
  });

  it("throws when a node has no type and no anyOf/oneOf/allOf", () => {
    expect(() => toStrictJsonSchema({ description: "no type" })).toThrow(
      /must have a type/,
    );
  });
});

describe("enumPreservingOutputFormat — parse", () => {
  const S = z.object({
    category: z.enum(["alpha", "beta", "gamma"]),
    tags: z.array(z.enum(["red", "green", "blue"])),
  });

  it("returns typed data on valid input", () => {
    const { parse } = enumPreservingOutputFormat(S);
    const value = parse(JSON.stringify({ category: "alpha", tags: ["red"] }));
    expect(value).toEqual({ category: "alpha", tags: ["red"] });
  });

  it("throws the JSON-parse message shape on malformed input", () => {
    const { parse } = enumPreservingOutputFormat(S);
    expect(() => parse("not json")).toThrow(
      /^Failed to parse structured output as JSON:/,
    );
  });

  it("throws the validation message shape on an out-of-vocab token", () => {
    const { parse } = enumPreservingOutputFormat(S);
    expect(() =>
      parse(JSON.stringify({ category: "quantum", tags: ["red"] })),
    ).toThrow(/Failed to parse structured output:[\s\S]*Validation issues:/);
  });

  it("truncates to the first 5 issues with an '... and N more' suffix", () => {
    const Many = z.object({
      a: z.enum(["x"]),
      b: z.enum(["x"]),
      c: z.enum(["x"]),
      d: z.enum(["x"]),
      e: z.enum(["x"]),
      f: z.enum(["x"]),
      g: z.enum(["x"]),
    });
    const { parse } = enumPreservingOutputFormat(Many);
    const bad = JSON.stringify({
      a: "n",
      b: "n",
      c: "n",
      d: "n",
      e: "n",
      f: "n",
      g: "n",
    });
    let message = "";
    try {
      parse(bad);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("Validation issues:");
    expect(message).toMatch(/\.\.\. and 2 more issue\(s\)/);
    // Exactly 5 issue bullets before the truncation suffix.
    expect(message.match(/^ {2}- /gm)?.length).toBe(5);
  });
});

describe("enumPreservingOutputFormat — production schema", () => {
  it("round-trips the real BriefGenerationSchema and keeps the risk-surface enum", () => {
    const { schema } = enumPreservingOutputFormat(BriefGenerationSchema);
    expect(allEnums(schema)).toContainEqual([...RiskSurfaceAttributes]);
  });
});
