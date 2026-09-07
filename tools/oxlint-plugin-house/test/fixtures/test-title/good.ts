import { describe, it, test } from "vitest";

const name = "x";

describe("the cap", () => {
  it("names the behaviour in one short sentence", () => {});
  it.skip("skips without a parenthetical", () => {});
  it.each([1, 2])("each form %i", () => {});
  test(`template with an ${name} expression (skipped: not static)`, () => {});
  it("exactly seventy characters long, which is the cap and therefore allowe", () => {});
});
