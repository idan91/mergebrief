// The drafts-off empty-state copy override.
import { describe, expect, it } from "vitest";

import { emptyCardCopy } from "./EmptyCard";

describe("emptyCardCopy", () => {
  it("promises next-push generation by default", () => {
    expect(emptyCardCopy(undefined)).toContain("next push");
  });

  it("the drafts-off override replaces the copy wholesale", () => {
    expect(emptyCardCopy("Drafts are off.")).toBe("Drafts are off.");
  });
});
