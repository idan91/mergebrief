import { describe, expect, it } from "vitest";
import {
  DEFAULT_HUGE_SPAN_RATIO,
  isHugeSpan,
  parseHugeSpanRatio,
} from "../../src/generation/huge-span";

describe("parseHugeSpanRatio", () => {
  it("defaults to 0.65 when the value is absent", () => {
    expect(parseHugeSpanRatio(undefined)).toBe(0.65);
    expect(DEFAULT_HUGE_SPAN_RATIO).toBe(0.65);
  });

  it("reads a ratio above zero and up to one", () => {
    expect(parseHugeSpanRatio("0.5")).toBe(0.5);
    expect(parseHugeSpanRatio("1")).toBe(1);
  });

  it("falls back to the default on an out-of-range or unparsable value", () => {
    expect(parseHugeSpanRatio("5")).toBe(0.65);
    expect(parseHugeSpanRatio("0")).toBe(0.65);
    expect(parseHugeSpanRatio("abc")).toBe(0.65);
  });
});

describe("isHugeSpan", () => {
  it("is false for a small incremental span relative to the whole PR", () => {
    expect(isHugeSpan(2, 20)).toBe(false);
  });

  it("is true once the incremental span reaches the default ratio", () => {
    expect(isHugeSpan(13, 20)).toBe(true);
    expect(isHugeSpan(18, 20)).toBe(true);
  });

  it("is never huge against a zero-sized whole-PR span", () => {
    expect(isHugeSpan(5, 0)).toBe(false);
  });

  it("honours a ratio passed by the composition root", () => {
    expect(isHugeSpan(10, 20, 0.5)).toBe(true);
    expect(isHugeSpan(10, 20, 0.65)).toBe(false);
  });
});
