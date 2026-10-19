// The `spend` command's TTY line, capped and uncapped.
import { describe, expect, it } from "vitest";
import { formatSpendLine } from "../src/commands/spend/run";

describe("formatSpendLine", () => {
  it.each([
    {
      name: "a capped Instance",
      slice: { startedRuns: 37, cap: 50 },
      line: "37 of 50 runs started today · resets at 00:00 UTC\n",
    },
    {
      name: "an uncapped Instance",
      slice: { startedRuns: 3 },
      line: "3 runs started today · no daily cap\n",
    },
  ])("prints $name", ({ slice, line }) => {
    expect(formatSpendLine(slice)).toBe(line);
  });
});
