// The `viewerIsAuthor` truth table gates author-only affordances in the FE,
// so it is true only for an exact match of two present logins.
import { describe, expect, it } from "vitest";
import type { GenerationRow } from "persistence";
import { GenerationStatuses } from "types";

import {
  buildGenerationSummary,
  deriveViewerIsAuthor,
} from "../src/routes/pr-view";

const READY = { kind: "ready-for-review", setBy: "repo" };
const UNKNOWN_KIND = { kind: "deploy-window", setBy: "repo" };

function makeHeldRow(unmetConditions: readonly unknown[]): GenerationRow {
  return {
    status: GenerationStatuses.HELD,
    phase: null,
    attempts: 0,
    errorCode: null,
    errorParams: null,
    updatedAt: new Date("2026-11-21T00:00:00Z"),
    unmetConditions: JSON.stringify(unmetConditions),
  } as GenerationRow;
}

describe("deriveViewerIsAuthor", () => {
  it("is true only when both logins are present and equal", () => {
    expect(deriveViewerIsAuthor("octocat", "octocat")).toBe(true);
  });

  it("is false when the logins differ", () => {
    expect(deriveViewerIsAuthor("octocat", "someone-else")).toBe(false);
  });

  it("is false when the author login is null", () => {
    expect(deriveViewerIsAuthor("octocat", null)).toBe(false);
  });

  it("is false when the viewer login is null", () => {
    expect(deriveViewerIsAuthor(null, "octocat")).toBe(false);
  });

  it("is false when both logins are null", () => {
    expect(deriveViewerIsAuthor(null, null)).toBe(false);
  });

  it("is false for empty-string logins", () => {
    expect(deriveViewerIsAuthor("", "")).toBe(false);
  });
});

describe("buildGenerationSummary on a held head", () => {
  it("marks the unmet list partial when an item is unreadable", () => {
    const summary = buildGenerationSummary(
      makeHeldRow([UNKNOWN_KIND, READY]),
      undefined,
    );

    expect(summary?.unmetConditions).toEqual([READY]);
    expect(summary?.unmetConditionsPartial).toBe(true);
  });

  it("marks the list partial with no items when none is readable", () => {
    const summary = buildGenerationSummary(
      makeHeldRow([UNKNOWN_KIND]),
      undefined,
    );

    expect(summary).not.toHaveProperty("unmetConditions");
    expect(summary?.unmetConditionsPartial).toBe(true);
  });

  it("sends no partial flag when every item is readable", () => {
    const summary = buildGenerationSummary(makeHeldRow([READY]), undefined);

    expect(summary?.unmetConditions).toEqual([READY]);
    expect(summary).not.toHaveProperty("unmetConditionsPartial");
  });
});
