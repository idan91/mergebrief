import { describe, expect, it } from "vitest";

import { awaitsReadyForReview } from "./draft-policy";

describe("awaitsReadyForReview", () => {
  it("holds a draft under a drafts-off policy", () => {
    const source = { draft: true, draftPolicy: { generate: false } };
    expect(awaitsReadyForReview(source)).toBe(true);
  });

  it.each([
    ["a ready PR under drafts off", false, { generate: false }],
    ["a draft under drafts on", true, { generate: true }],
    ["a draft with no policy on the meta", true, undefined],
  ] as const)("does not hold %s", (_label, draft, draftPolicy) => {
    const source =
      draftPolicy === undefined ? { draft } : { draft, draftPolicy };
    expect(awaitsReadyForReview(source)).toBe(false);
  });
});
