import { describe, expect, it } from "vitest";
import { enumPreservingJsonSchema } from "generators";
import {
  BriefGenerationSchema,
  briefGenerationSchemaWith,
  DeltaBriefGenerationSchema,
  detailGenerationSchemaWith,
  DetailGenerationSchema,
  GroupingGenerationSchema,
  GroupingWithMediaGenerationSchema,
  RevisionNarrativeGenerationSchema,
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

  it("brief offering Summary Media", () => {
    const schema = briefGenerationSchemaWith([], true);

    expect(serializeWireSchema(schema)).toMatchSnapshot();
  });

  it("brief offering Summary Media with a custom attribute", () => {
    const schema = briefGenerationSchemaWith(["example-attribute"], true);

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

  it("grouping offering Summary Media", () => {
    expect(
      serializeWireSchema(GroupingWithMediaGenerationSchema),
    ).toMatchSnapshot();
  });

  it("revision narrative", () => {
    expect(
      serializeWireSchema(RevisionNarrativeGenerationSchema),
    ).toMatchSnapshot();
  });
});

/** The plain brief's count, which compiles: each optional property multiplies the compiled grammar. */
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
  ["media brief", briefGenerationSchemaWith([], true)],
  [
    "custom media brief",
    briefGenerationSchemaWith(["example-attribute"], true),
  ],
  ["delta", DeltaBriefGenerationSchema],
  ["detail", DetailGenerationSchema],
  ["custom detail", detailGenerationSchemaWith(["example-attribute"])],
  ["grouping", GroupingGenerationSchema],
  ["media grouping", GroupingWithMediaGenerationSchema],
  ["revision narrative", RevisionNarrativeGenerationSchema],
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

  it.each([
    ["brief", BriefGenerationSchema, briefGenerationSchemaWith([], true)],
    ["grouping", GroupingGenerationSchema, GroupingWithMediaGenerationSchema],
  ])("Summary Media adds no optional property to the %s", (_, plain, media) => {
    expect(measureWireSchema(media).optional).toBe(
      measureWireSchema(plain).optional,
    );
  });
});
