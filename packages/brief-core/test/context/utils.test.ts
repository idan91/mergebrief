import { describe, expect, it } from "vitest";
import { truncateToCodeUnits } from "../../src/context/utils";

const EMOJI = "\u{1F600}";

describe("truncateToCodeUnits", () => {
  it("keeps text at or under the cap whole", () => {
    expect(truncateToCodeUnits(`ab${EMOJI}`, 4)).toBe(`ab${EMOJI}`);
    expect(truncateToCodeUnits("ab", 5)).toBe("ab");
  });

  it("cuts plain text at the cap", () => {
    expect(truncateToCodeUnits("abcdef", 3)).toBe("abc");
  });

  it("keeps a surrogate pair that ends exactly at the cap", () => {
    expect(truncateToCodeUnits(`ab${EMOJI}cd`, 4)).toBe(`ab${EMOJI}`);
  });

  it("steps back before a surrogate pair the cap would split", () => {
    const cut = truncateToCodeUnits(`ab${EMOJI}cd`, 3);

    expect(cut).toBe("ab");
    expect(cut.isWellFormed()).toBe(true);
  });

  it("returns nothing for a cap of zero or less", () => {
    expect(truncateToCodeUnits("abc", 0)).toBe("");
    expect(truncateToCodeUnits("abc", -2)).toBe("");
  });
});
