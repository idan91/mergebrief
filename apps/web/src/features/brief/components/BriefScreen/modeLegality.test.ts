import { describe, expect, it } from "vitest";

import { deriveRegionBlocks } from "./modeLegality";

/**
 * The legality table asserted column by column, plus the axis-precedence
 * boundary between the columns.
 */
describe("deriveRegionBlocks", () => {
  it("Full renders the whole region", () => {
    const blocks = deriveRegionBlocks({ scope: "full", focus: false });
    expect(blocks).toEqual({
      summary: true,
      toolbar: true,
      conversation: true,
      groupToc: true,
    });
  });

  it("Changes keeps only the summary", () => {
    const blocks = deriveRegionBlocks({ scope: "changes", focus: false });
    expect(blocks).toEqual({
      summary: true,
      toolbar: false,
      conversation: false,
      groupToc: false,
    });
  });

  it("Focus empties the region", () => {
    const blocks = deriveRegionBlocks({ scope: "full", focus: true });
    expect(blocks).toEqual({
      summary: false,
      toolbar: false,
      conversation: false,
      groupToc: false,
    });
  });

  it("focus wins over scope", () => {
    const blocks = deriveRegionBlocks({ scope: "changes", focus: true });
    expect(blocks).toEqual({
      summary: false,
      toolbar: false,
      conversation: false,
      groupToc: false,
    });
  });
});
