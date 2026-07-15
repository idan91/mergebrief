// Unit tests for the `viewerIsAuthor` derivation (BRIEF-43). The truth table
// is security-relevant: the boolean gates author-only affordances in the FE,
// so it must NEVER be true for a null/missing author login or a null/missing
// viewer login — only for an exact match of two present logins.
import { describe, expect, it } from "vitest";
import { deriveViewerIsAuthor } from "../src/routes/pr-view";

describe("deriveViewerIsAuthor", () => {
  it("is true only when both logins are present and equal", () => {
    expect(deriveViewerIsAuthor("octocat", "octocat")).toBe(true);
  });

  it("is false when the logins differ", () => {
    expect(deriveViewerIsAuthor("octocat", "someone-else")).toBe(false);
  });

  it("is false when the author login is missing (null)", () => {
    expect(deriveViewerIsAuthor("octocat", null)).toBe(false);
  });

  it("is false when the viewer login is missing (null)", () => {
    expect(deriveViewerIsAuthor(null, "octocat")).toBe(false);
  });

  it("is false when both are missing (never null === null)", () => {
    expect(deriveViewerIsAuthor(null, null)).toBe(false);
  });

  it("is false for empty-string logins", () => {
    expect(deriveViewerIsAuthor("", "")).toBe(false);
  });
});
