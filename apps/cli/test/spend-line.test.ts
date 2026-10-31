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
    {
      name: "a capped Instance's large runs",
      slice: { startedRuns: 17, cap: 50, largeRuns: { runs: 2, units: 12 } },
      line: "17 of 50 runs started today · 2 runs briefed in parts took 12 of them · resets at 00:00 UTC\n",
    },
    {
      name: "an uncapped Instance's one large run",
      slice: { startedRuns: 4, largeRuns: { runs: 1, units: 3 } },
      line: "4 runs started today · 1 run briefed in parts took 3 of them · no daily cap\n",
    },
  ])("prints $name", ({ slice, line }) => {
    expect(formatSpendLine(slice)).toBe(line);
  });
});
