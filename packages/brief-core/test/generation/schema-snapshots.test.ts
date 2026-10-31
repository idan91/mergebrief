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

  it("revision narrative", () => {
    expect(
      serializeWireSchema(RevisionNarrativeGenerationSchema),
    ).toMatchSnapshot();
  });
});
