import { describe, expect, it } from "vitest";

import { readAwaitingDetailKey } from "./awaiting-head";

describe("readAwaitingDetailKey", () => {
  it.each([
    ["an open PR", false, false, "pulls.awaitingTrigger.copy"],
    ["a held draft", false, true, "pulls.awaitingTrigger.readyForReviewCopy"],
    ["a closed PR", true, false, "pulls.awaitingTrigger.notOpenCopy"],
    ["a closed held draft", true, true, "pulls.awaitingTrigger.notOpenCopy"],
  ] as const)(
    "picks the detail for %s",
    (_label, noLongerOpen, awaitsReadyForReview, key) => {
      expect(
        readAwaitingDetailKey({ noLongerOpen, awaitsReadyForReview }),
      ).toBe(key);
    },
  );
});
