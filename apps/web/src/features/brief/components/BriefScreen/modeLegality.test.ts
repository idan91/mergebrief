import { describe, expect, it } from "vitest";

import {
  CONCERNS_FOCUS_LENS_REASON,
  SCOPE_LENS_REASON,
  deriveRegionBlocks,
} from "./modeLegality";

/**
 * The spec's legality table (brief-134-details-spec.md, "The mode model"),
 * asserted column by column — the table is the source of truth, these are
 * its four columns plus the axis-precedence seams between them.
 */
describe("deriveRegionBlocks", () => {
  it("Full+Story renders the whole region", () => {
    const blocks = deriveRegionBlocks({
      lens: "story",
      scope: "full",
      focus: false,
    });
    expect(blocks).toEqual({
      summary: true,
      toolbar: "full",
      conversation: true,
      groupToc: true,
      lensControl: { state: "active" },
    });
  });

  it("Full+Concerns keeps summary + conversation, trims the toolbar, drops the TOC", () => {
    const blocks = deriveRegionBlocks({
      lens: "concerns",
      scope: "full",
      focus: false,
    });
    expect(blocks).toEqual({
      summary: true,
      toolbar: "filter-and-attrs",
      conversation: true,
      groupToc: false,
      lensControl: { state: "active" },
    });
  });

  it("Changes keeps only the summary and disables the lens with the scope reason", () => {
    const blocks = deriveRegionBlocks({
      lens: "story",
      scope: "changes",
      focus: false,
    });
    expect(blocks).toEqual({
      summary: true,
      toolbar: "none",
      conversation: false,
      groupToc: false,
      lensControl: { state: "disabled", reason: SCOPE_LENS_REASON },
    });
  });

  it("Focus empties the region and disables the lens with the focus reason", () => {
    const blocks = deriveRegionBlocks({
      lens: "story",
      scope: "full",
      focus: true,
    });
    expect(blocks).toEqual({
      summary: false,
      toolbar: "none",
      conversation: false,
      groupToc: false,
      lensControl: { state: "disabled", reason: CONCERNS_FOCUS_LENS_REASON },
    });
  });

  it("focus wins over scope: the focus reason (not the scope one) explains the lens", () => {
    const blocks = deriveRegionBlocks({
      lens: "story",
      scope: "changes",
      focus: true,
    });
    expect(blocks).toEqual({
      summary: false,
      toolbar: "none",
      conversation: false,
      groupToc: false,
      lensControl: { state: "disabled", reason: CONCERNS_FOCUS_LENS_REASON },
    });
  });

  it("Concerns+focus does not exist: focus derives the Story column regardless of lens", () => {
    // The explicit contract replacing the silent setViewMode("story"): even
    // if a concerns lens value reaches the derivation while focus is on, the
    // region renders the Focus column (Story implied).
    expect(
      deriveRegionBlocks({ lens: "concerns", scope: "full", focus: true }),
    ).toEqual(
      deriveRegionBlocks({ lens: "story", scope: "full", focus: true }),
    );
  });

  it("Changes+Concerns still derives the Changes column (scope wins over lens)", () => {
    const blocks = deriveRegionBlocks({
      lens: "concerns",
      scope: "changes",
      focus: false,
    });
    expect(blocks.toolbar).toBe("none");
    expect(blocks.conversation).toBe(false);
    expect(blocks.lensControl).toEqual({
      state: "disabled",
      reason: SCOPE_LENS_REASON,
    });
  });
});
