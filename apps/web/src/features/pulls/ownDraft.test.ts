// The own-draft derivation truth table (BRIEF-43 / ADR 0031). The state is
// derived at READ time from two server-provided booleans — never stored,
// never self-declared. Both must hold: someone else's draft and the viewer's
// own ready PR are both plain reviewer views.
import { describe, expect, it } from "vitest";
import { isOwnDraft } from "./ownDraft";

describe("isOwnDraft", () => {
  it("is true only for the viewer's own draft", () => {
    expect(isOwnDraft({ draft: true, viewerIsAuthor: true })).toBe(true);
  });

  it("is false for someone else's draft", () => {
    expect(isOwnDraft({ draft: true, viewerIsAuthor: false })).toBe(false);
  });

  it("is false for the viewer's own ready (non-draft) PR", () => {
    expect(isOwnDraft({ draft: false, viewerIsAuthor: true })).toBe(false);
  });

  it("is false for an unrelated ready PR", () => {
    expect(isOwnDraft({ draft: false, viewerIsAuthor: false })).toBe(false);
  });
});
