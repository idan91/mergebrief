import { describe, expect, it } from "vitest";

import { countWords } from "./utils";

describe("countWords", () => {
  it("counts words across any whitespace", () => {
    expect(countWords("Fix the\n\nleak   in  parsing")).toBe(5);
  });
});
