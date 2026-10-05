import { describe, expect, it } from "vitest";
import {
  DEFAULT_HUGE_SPAN_RATIO,
  isHugeSpan,
  parseHugeSpanRatio,
} from "../../src/generation/huge-span";

describe("parseHugeSpanRatio", () => {
  it("defaults to 0.65 when the value is absent or empty", () => {
    expect(DEFAULT_HUGE_SPAN_RATIO).toBe(0.65);
    expect(parseHugeSpanRatio(undefined)).toEqual({ ok: true, value: 0.65 });
    expect(parseHugeSpanRatio("")).toEqual({ ok: true, value: 0.65 });
  });

  it("reads a ratio above zero and up to one", () => {
    expect(parseHugeSpanRatio("0.5")).toEqual({ ok: true, value: 0.5 });
    expect(parseHugeSpanRatio("1")).toEqual({ ok: true, value: 1 });
  });

  it("refuses zero, a negative ratio and a ratio above one", () => {
    expect(parseHugeSpanRatio("0").ok).toBe(false);
    expect(parseHugeSpanRatio("-0.5").ok).toBe(false);
    expect(parseHugeSpanRatio("5").ok).toBe(false);
  });

  it("refuses a value without echoing it", () => {
    for (const raw of ["7.77", "leak-marker"]) {
      const result = parseHugeSpanRatio(raw);
      expect(result.ok).toBe(false);
      if (result.ok) {
        continue;
      }
      expect(result.error).not.toContain(raw);
    }
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
