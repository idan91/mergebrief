import { afterEach, describe, expect, it } from "vitest";
import { hugeSpanRatio, isHugeSpan } from "../src/huge-span";

const ENV_KEY = "HUGE_SPAN_RATIO";

describe("isHugeSpan", () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("defaults to a 0.65 ratio", () => {
    expect(hugeSpanRatio()).toBe(0.65);
  });

  it("is false for a small incremental span relative to the whole PR", () => {
    expect(isHugeSpan(2, 20)).toBe(false);
  });

  it("is true once the incremental span reaches the ratio", () => {
    expect(isHugeSpan(13, 20)).toBe(true); // 0.65 exactly
    expect(isHugeSpan(18, 20)).toBe(true);
  });

  it("is never huge against a zero-sized whole-PR span", () => {
    expect(isHugeSpan(5, 0)).toBe(false);
  });

  it("honors an HUGE_SPAN_RATIO override", () => {
    process.env[ENV_KEY] = "0.5";
    expect(hugeSpanRatio()).toBe(0.5);
    expect(isHugeSpan(10, 20)).toBe(true);
  });

  it("falls back to the default on an out-of-range override", () => {
    process.env[ENV_KEY] = "5";
    expect(hugeSpanRatio()).toBe(0.65);
  });
});
