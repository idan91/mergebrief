import { describe, expect, it } from "vitest";

import { getShortSha } from "./short-sha";

describe("getShortSha", () => {
  it("keeps the first seven characters", () => {
    expect(getShortSha("abcdef1234567890")).toBe("abcdef1");
  });
});
