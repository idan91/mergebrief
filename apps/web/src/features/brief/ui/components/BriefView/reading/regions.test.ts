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
      phoneBar: true,
      carryOver: true,
    });
  });

  it("Changes keeps the summary, the carry-over bar and the phone bar", () => {
    const regions = deriveVisibleRegions({ scope: "changes", focus: false });
    expect(regions).toEqual({
      summary: true,
      toolbar: false,
      conversation: false,
      sidebar: false,
      phoneBar: true,
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
      phoneBar: false,
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
      phoneBar: false,
      carryOver: false,
    });
  });

  it("never shows the conversation without the summary", () => {
    const combos = [
      { scope: "full", focus: false },
      { scope: "full", focus: true },
      { scope: "changes", focus: false },
      { scope: "changes", focus: true },
    ] as const;

    const orphaned = combos.filter((modes) => {
      const regions = deriveVisibleRegions(modes);
      return regions.conversation && !regions.summary;
    });

    expect(orphaned).toEqual([]);
  });
});
