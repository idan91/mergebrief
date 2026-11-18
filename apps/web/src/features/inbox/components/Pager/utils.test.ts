import { describe, expect, it } from "vitest";

import { listPageSteps } from "./utils";

describe("listPageSteps", () => {
  it("keeps the ends and the neighbours, with a gap where pages are skipped", () => {
    expect(listPageSteps(1, 1)).toEqual([1]);
    expect(listPageSteps(1, 3)).toEqual([1, 2, 3]);
    expect(listPageSteps(5, 12)).toEqual([1, "gap", 4, 5, 6, "gap", 12]);
    expect(listPageSteps(12, 12)).toEqual([1, "gap", 11, 12]);
    expect(listPageSteps(2, 4)).toEqual([1, 2, 3, 4]);
  });
});
