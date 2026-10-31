import { describe, expect, it } from "vitest";
import {
  countHunks,
  decideCallPlan,
  estimateTokens,
} from "../../src/generation/size";
import { BYTES_PER_TOKEN } from "../../src/generation/size/consts";

const FILE_HEADER = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n";

function makeDiff(hunks: number): string {
  return `${FILE_HEADER}${"@@ -1 +1 @@\n-x\n+y\n".repeat(hunks)}`;
}

/** One hunk, padded with an added line to exactly `bytes` ASCII bytes. */
function makeDiffOfBytes(bytes: number): string {
  const hunk = makeDiff(1);
  const padding = "z".repeat(bytes - hunk.length - 2);
  return `${hunk}+${padding}\n`;
}

describe("estimateTokens", () => {
  it("reads diff text at two bytes per token", () => {
    expect(estimateTokens("abcdefgh", BYTES_PER_TOKEN.DIFF)).toBe(4);
  });

  it("reads outline text at 1.7 bytes per token", () => {
    expect(estimateTokens("a".repeat(170), BYTES_PER_TOKEN.OUTLINE)).toBe(100);
  });

  it("counts UTF-8 bytes, not UTF-16 code units", () => {
    expect(estimateTokens("éé", BYTES_PER_TOKEN.DIFF)).toBe(2);
  });
});

describe("countHunks", () => {
  it("counts hunk headers across every file", () => {
    const diff = `${makeDiff(2)}${makeDiff(3)}`;

    expect(countHunks(diff)).toBe(5);
  });

  it("ignores a changed line whose text starts with @@", () => {
    const diff = `${FILE_HEADER}@@ -1 +1 @@\n-@@ old\n+@@ new\n`;

    expect(countHunks(diff)).toBe(1);
  });

  it("finds none in an empty diff", () => {
    expect(countHunks("")).toBe(0);
  });
});

describe("decideCallPlan", () => {
  it("keeps a diff at the hunk limit on one call", () => {
    const diff = makeDiff(120);

    const plan = decideCallPlan({ diff });

    expect(plan).toEqual({
      kind: "single",
      estimatedInputTokens: 1104,
      hunkCount: 120,
      forced: false,
    });
  });

  it("goes multi-call past 120 hunks", () => {
    expect(decideCallPlan({ diff: makeDiff(121) }).kind).toBe("multi");
  });

  it("goes multi-call past 400k estimated input tokens", () => {
    const atLimit = makeDiffOfBytes(800_000);
    const overLimit = makeDiffOfBytes(800_002);

    expect(decideCallPlan({ diff: atLimit }).kind).toBe("single");
    expect(decideCallPlan({ diff: overLimit }).kind).toBe("multi");
  });

  it("goes multi-call when forced, whatever the size", () => {
    const plan = decideCallPlan({ diff: makeDiff(1), forceMultiCall: true });

    expect(plan.kind).toBe("multi");
    expect(plan.forced).toBe(true);
  });
});
