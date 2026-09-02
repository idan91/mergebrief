import { describe, expect, it } from "vitest";

import { deriveVisibleRegions } from "./regions";

/**
 * The visibility table asserted column by column, plus the mode-precedence
 * boundary between the columns.
 */
describe("deriveVisibleRegions", () => {
  it("Full renders the whole region", () => {
    const regions = deriveVisibleRegions({ scope: "full", focus: false });
    expect(regions).toEqual({
      summary: true,
      toolbar: true,
      conversation: true,
      sidebar: true,
    });
  });

  it("Changes keeps only the summary", () => {
    const regions = deriveVisibleRegions({ scope: "changes", focus: false });
    expect(regions).toEqual({
      summary: true,
      toolbar: false,
      conversation: false,
      sidebar: false,
    });
  });

  it("Focus empties the region", () => {
    const regions = deriveVisibleRegions({ scope: "full", focus: true });
    expect(regions).toEqual({
      summary: false,
      toolbar: false,
      conversation: false,
      sidebar: false,
    });
  });

  it("focus wins over scope", () => {
    const regions = deriveVisibleRegions({ scope: "changes", focus: true });
    expect(regions).toEqual({
      summary: false,
      toolbar: false,
      conversation: false,
      sidebar: false,
    });
  });
});
