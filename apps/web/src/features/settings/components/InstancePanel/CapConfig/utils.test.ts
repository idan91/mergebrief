import { describe, expect, it } from "vitest";

import { buildSpendBlock } from "./utils";

describe("buildSpendBlock", () => {
  it("writes the cap under the spend block", () => {
    expect(buildSpendBlock(50)).toBe("spend:\n  maxGenerationsPerDay: 50");
  });
});
