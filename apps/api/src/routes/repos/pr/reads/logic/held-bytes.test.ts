import { describe, expect, it } from "vitest";
import { measureHeldBytes } from "./held-bytes";

describe("measureHeldBytes", () => {
  it("sizes a Latin-1 string at one byte per unit, any other at two", () => {
    expect(measureHeldBytes("é".repeat(5))).toBe(5);
    expect(measureHeldBytes("ab€")).toBe(6);
  });
});
