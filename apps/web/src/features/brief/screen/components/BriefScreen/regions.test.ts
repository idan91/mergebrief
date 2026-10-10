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
      carryOver: true,
    });
  });

  it("Changes keeps the summary and the carry-over bar", () => {
    const regions = deriveVisibleRegions({ scope: "changes", focus: false });
    expect(regions).toEqual({
      summary: true,
      toolbar: false,
      conversation: false,
      sidebar: false,
      carryOver: true,
    });
  });

  it("Focus empties the region", () => {
    const regions = deriveVisibleRegions({ scope: "full", focus: true });
    expect(regions).toEqual({
      summary: false,
      toolbar: false,
      conversation: false,
      sidebar: false,
      carryOver: false,
    });
  });

  it("focus wins over scope", () => {
    const regions = deriveVisibleRegions({ scope: "changes", focus: true });
    expect(regions).toEqual({
      summary: false,
      toolbar: false,
      conversation: false,
      sidebar: false,
      carryOver: false,
    });
  });
});
