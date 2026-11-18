import { describe, it, test } from "vitest";

describe("a describe title that runs far past the seventy character cap set right here", () => {
  it("names the behaviour (with a parenthetical aside)", () => {});
  it.skip("skipped but still far too long a title to be a behaviour name at all, really", () => {});
  it.only("only form (parenthetical)", () => {});
  it.todo("todo form (parenthetical)");
  it.each([1, 2])("each form (parenthetical) %i", () => {});
  test(`template title without expressions (parenthetical)`, () => {});
});
