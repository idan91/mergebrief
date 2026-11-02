import { describe, expect, it } from "vitest";
import { enumPreservingJsonSchema } from "generators";
import {
  BriefGenerationSchema,
  briefGenerationSchemaWith,
  DeltaBriefGenerationSchema,
  detailGenerationSchemaWith,
  DetailGenerationSchema,
  GroupingGenerationSchema,
  RevisionNarrativeGenerationSchema,
  SummaryMediaAnswerSchema,
} from "../../src/types";

// Snapshotted as a string so key order is pinned: these bytes are what every
// adapter sends, and an object snapshot sorts keys.
function serializeWireSchema(
  schema: Parameters<typeof enumPreservingJsonSchema>[0],
): string {
  return JSON.stringify(enumPreservingJsonSchema(schema), null, 2);
}

describe("wire json schemas are byte-pinned", () => {
  it("brief", () => {
    expect(serializeWireSchema(BriefGenerationSchema)).toMatchSnapshot();
  });

  it("brief with a custom attribute", () => {
    const schema = briefGenerationSchemaWith(["example-attribute"]);

    expect(serializeWireSchema(schema)).toMatchSnapshot();
  });

  it("delta", () => {
    expect(serializeWireSchema(DeltaBriefGenerationSchema)).toMatchSnapshot();
  });

  it("detail", () => {
    expect(serializeWireSchema(DetailGenerationSchema)).toMatchSnapshot();
  });

  it("detail with a custom attribute", () => {
    const schema = detailGenerationSchemaWith(["example-attribute"]);

    expect(serializeWireSchema(schema)).toMatchSnapshot();
  });

  it("grouping", () => {
    expect(serializeWireSchema(GroupingGenerationSchema)).toMatchSnapshot();
  });

  it("summary media", () => {
    expect(serializeWireSchema(SummaryMediaAnswerSchema)).toMatchSnapshot();
  });

  it("revision narrative", () => {
    expect(
      serializeWireSchema(RevisionNarrativeGenerationSchema),
    ).toMatchSnapshot();
  });
});

/**
 * The plain brief's count. The API's real limit is the compiled grammar's
 * size, which only `smoke:schemas` measures; this holds what the docs name as
 * costly: optional properties and unions.
 */
const MAX_OPTIONAL_PROPERTIES = 2;

interface WireComplexity {
  optional: number;
  unions: number;
}

function countWireComplexity(node: unknown, counts: WireComplexity): void {
  if (Array.isArray(node)) {
    for (const entry of node) {
      countWireComplexity(entry, counts);
    }
    return;
  }
  if (typeof node !== "object" || node === null) {
    return;
  }

  const record = node as Record<string, unknown>;
  if ("anyOf" in record || Array.isArray(record["type"])) {
    counts.unions += 1;
  }
  const properties = record["properties"];
  if (record["type"] === "object" && typeof properties === "object") {
    const required = new Set(record["required"] as string[] | undefined);
    const names = Object.keys(properties ?? {});
    counts.optional += names.filter((name) => !required.has(name)).length;
  }
  for (const [key, value] of Object.entries(record)) {
    if (key !== "description") {
      countWireComplexity(value, counts);
    }
  }
}

function measureWireSchema(
  schema: Parameters<typeof enumPreservingJsonSchema>[0],
): WireComplexity {
  const counts: WireComplexity = { optional: 0, unions: 0 };
  countWireComplexity(enumPreservingJsonSchema(schema), counts);
  return counts;
}

const WIRE_VARIANTS = [
  ["brief", BriefGenerationSchema],
  ["custom brief", briefGenerationSchemaWith(["example-attribute"])],
  ["delta", DeltaBriefGenerationSchema],
  ["detail", DetailGenerationSchema],
  ["custom detail", detailGenerationSchemaWith(["example-attribute"])],
  ["grouping", GroupingGenerationSchema],
  ["revision narrative", RevisionNarrativeGenerationSchema],
  ["summary media", SummaryMediaAnswerSchema],
] as const;

describe("wire json schemas stay within the compile budget", () => {
  it.each(WIRE_VARIANTS)("the %s schema uses no union", (_, schema) => {
    expect(measureWireSchema(schema).unions).toBe(0);
  });

  it.each(WIRE_VARIANTS)(
    "the %s schema keeps the optional budget",
    (_, schema) => {
      expect(measureWireSchema(schema).optional).toBeLessThanOrEqual(
        MAX_OPTIONAL_PROPERTIES,
      );
    },
  );
});
