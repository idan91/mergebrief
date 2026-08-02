import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { enumPreservingJsonSchema } from "../src/validation/jsonSchema";
import {
  stripInjectedNulls,
  withAllRequired,
} from "../src/validation/openaiStrict";

// Mirrors the shapes that broke on Azure via OpenRouter (BRIEF-77): an
// optional enum-bearing array prop nested in an array of objects
// (chunks[].riskNotes), alongside genuinely nullable required props.
const NestedSchema = z.object({
  chunks: z.array(
    z.object({
      title: z.string(),
      riskNotes: z.array(z.enum(["race", "contract"])).optional(),
    }),
  ),
  line: z.number().int().nullable(),
  summary: z.string().optional(),
});

function wire(schema: z.ZodType): Record<string, unknown> {
  return enumPreservingJsonSchema(schema);
}

function objectAt(node: unknown, ...path: string[]): Record<string, unknown> {
  let current: unknown = node;
  for (const key of path) {
    expect(current).toBeTypeOf("object");
    current = (current as Record<string, unknown>)[key];
  }
  expect(current).toBeTypeOf("object");
  return current as Record<string, unknown>;
}

describe("withAllRequired", () => {
  it("lists every property as required at every object level", () => {
    const out = withAllRequired(wire(NestedSchema));
    expect(out["required"]).toEqual(["chunks", "line", "summary"]);
    const items = objectAt(out, "properties", "chunks", "items");
    expect(items["required"]).toEqual(["title", "riskNotes"]);
  });

  it("widens formerly-optional properties to a null-union anyOf", () => {
    const out = withAllRequired(wire(NestedSchema));
    const riskNotes = objectAt(
      out,
      "properties",
      "chunks",
      "items",
      "properties",
      "riskNotes",
    );
    const anyOf = riskNotes["anyOf"];
    expect(Array.isArray(anyOf)).toBe(true);
    const branches = anyOf as Record<string, unknown>[];
    expect(branches).toHaveLength(2);
    expect(branches[1]).toEqual({ type: "null" });
    // The enum survives inside the non-null branch — the closed vocabulary
    // must stay server-enforced, not be widened away.
    expect(objectAt(branches[0], "items")["enum"]).toEqual([
      "race",
      "contract",
    ]);
  });

  it("leaves required and already-nullable properties untouched", () => {
    const original = wire(NestedSchema);
    const out = withAllRequired(original);
    expect(objectAt(out, "properties", "line")).toEqual(
      objectAt(original, "properties", "line"),
    );
    expect(
      objectAt(out, "properties", "chunks", "items", "properties", "title"),
    ).toEqual(
      objectAt(
        original,
        "properties",
        "chunks",
        "items",
        "properties",
        "title",
      ),
    );
  });

  it("does not mutate its input", () => {
    const original = wire(NestedSchema);
    const before = JSON.stringify(original);
    withAllRequired(original);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("transforms objects referenced through $defs", () => {
    const Shared = z.object({ note: z.string(), attr: z.string().optional() });
    const Reusing = z.object({ a: Shared, b: Shared });
    const out = withAllRequired(wire(Reusing));
    const defs = out["$defs"];
    expect(isRecordLike(defs)).toBe(true);
    const [def] = Object.values(defs as Record<string, unknown>);
    expect(objectAt(def)["required"]).toEqual(["note", "attr"]);
  });
});

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("stripInjectedNulls", () => {
  const schema = wire(NestedSchema);

  it("removes nulls in formerly-optional slots, at depth", () => {
    const value = {
      chunks: [
        { title: "a", riskNotes: null },
        { title: "b", riskNotes: ["race"] },
      ],
      line: 3,
      summary: null,
    };
    expect(stripInjectedNulls(schema, value)).toEqual({
      chunks: [{ title: "a" }, { title: "b", riskNotes: ["race"] }],
      line: 3,
    });
  });

  it("keeps nulls the original schema genuinely allows", () => {
    const value = { chunks: [], line: null };
    expect(stripInjectedNulls(schema, value)).toEqual({
      chunks: [],
      line: null,
    });
  });

  it("round-trips through the domain Zod schema", () => {
    const stripped = stripInjectedNulls(schema, {
      chunks: [{ title: "a", riskNotes: null }],
      line: null,
      summary: null,
    });
    const parsed = NestedSchema.safeParse(stripped);
    expect(parsed.success).toBe(true);
  });

  it("resolves $refs when stripping shared object shapes", () => {
    const Shared = z.object({ note: z.string(), attr: z.string().optional() });
    const Reusing = z.object({ a: Shared, b: Shared });
    const refWire = wire(Reusing);
    const stripped = stripInjectedNulls(refWire, {
      a: { note: "x", attr: null },
      b: { note: "y", attr: "kept" },
    });
    expect(stripped).toEqual({
      a: { note: "x" },
      b: { note: "y", attr: "kept" },
    });
  });

  it("passes non-object payloads through untouched", () => {
    expect(stripInjectedNulls(schema, null)).toBeNull();
    expect(stripInjectedNulls(schema, "raw")).toBe("raw");
  });
});
