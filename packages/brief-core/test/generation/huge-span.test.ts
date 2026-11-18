import { describe, expect, it } from "vitest";
import {
  DEFAULT_HUGE_SPAN_RATIO,
  exceedsCallLimits,
  isHugeSpan,
} from "../../src/generation/huge-span";

const FILE_HEADER = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n";
const MAX_INPUT_BYTES = 800_000;

function makeDiff(hunks: number): string {
  return `${FILE_HEADER}${"@@ -1 +1 @@\n-x\n+y\n".repeat(hunks)}`;
}

describe("DEFAULT_HUGE_SPAN_RATIO", () => {
  it("is 0.65", () => {
    expect(DEFAULT_HUGE_SPAN_RATIO).toBe(0.65);
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

describe("exceedsCallLimits", () => {
  it("passes a small span with a small request", () => {
    const diff = makeDiff(3);

    expect(exceedsCallLimits(diff, () => `prompt\n${diff}`)).toBe(false);
  });

  it("refuses a span of more than 120 hunks", () => {
    const diff = makeDiff(121);

    expect(exceedsCallLimits(makeDiff(120), () => "")).toBe(false);
    expect(exceedsCallLimits(diff, () => "")).toBe(true);
  });

  it("refuses a request past 400k tokens at two bytes per token", () => {
    const atLimit = "a".repeat(MAX_INPUT_BYTES);

    expect(exceedsCallLimits(makeDiff(1), () => atLimit)).toBe(false);
    expect(exceedsCallLimits(makeDiff(1), () => `${atLimit}aa`)).toBe(true);
  });

  it("refuses a span diff past the limit without rendering the request", () => {
    const diff = `${makeDiff(1)}+${"a".repeat(MAX_INPUT_BYTES)}\n`;
    let rendered = false;

    const exceeds = exceedsCallLimits(diff, () => {
      rendered = true;
      return diff;
    });

    expect(exceeds).toBe(true);
    expect(rendered).toBe(false);
  });
});
