import { describe, expect, it } from "vitest";
import {
  classifyBaseline,
  MIN_VERDICT_RUNS,
  verdictFor,
} from "../eval/verdicts";

/**
 * Verdict rules: baseline classes stable-pass (all) / flaky (some) /
 * stable-fail (none); REGRESSION = stable-pass failing ≥2 of 5; 1/5 = WARN;
 * flaky never gates; stable-fail passing = IMPROVEMENT. Verdicts only at
 * >= MIN_VERDICT_RUNS on BOTH sides.
 */

describe("classifyBaseline", () => {
  it("classifies all-pass as stable-pass", () => {
    expect(classifyBaseline({ passes: 5, runs: 5 })).toBe("stable-pass");
  });
  it("classifies zero-pass as stable-fail", () => {
    expect(classifyBaseline({ passes: 0, runs: 5 })).toBe("stable-fail");
  });
  it("classifies partial as flaky", () => {
    expect(classifyBaseline({ passes: 3, runs: 5 })).toBe("flaky");
  });
});

describe("verdictFor", () => {
  it("flags a stable-pass property failing 2 of 5 as regression", () => {
    expect(verdictFor({ passes: 5, runs: 5 }, { passes: 3, runs: 5 })).toBe(
      "regression",
    );
  });
  it("flags a stable-pass property failing 1 of 5 as warn", () => {
    expect(verdictFor({ passes: 5, runs: 5 }, { passes: 4, runs: 5 })).toBe(
      "warn",
    );
  });
  it("keeps a stable-pass property passing 5 of 5 unchanged", () => {
    expect(verdictFor({ passes: 5, runs: 5 }, { passes: 5, runs: 5 })).toBe(
      "unchanged",
    );
  });
  it("never gates on a flaky baseline — informational only", () => {
    expect(verdictFor({ passes: 3, runs: 5 }, { passes: 0, runs: 5 })).toBe(
      "flaky-delta",
    );
    expect(verdictFor({ passes: 3, runs: 5 }, { passes: 5, runs: 5 })).toBe(
      "flaky-delta",
    );
  });
  it("marks a stable-fail property now passing as improvement", () => {
    expect(verdictFor({ passes: 0, runs: 5 }, { passes: 5, runs: 5 })).toBe(
      "improvement",
    );
    expect(verdictFor({ passes: 0, runs: 5 }, { passes: 1, runs: 5 })).toBe(
      "improvement",
    );
  });
  it("keeps a stable-fail property still failing unchanged", () => {
    expect(verdictFor({ passes: 0, runs: 5 }, { passes: 0, runs: 5 })).toBe(
      "unchanged",
    );
  });
  it("withholds verdicts below the minimum run floor on either side", () => {
    expect(MIN_VERDICT_RUNS).toBe(5);
    expect(verdictFor({ passes: 5, runs: 5 }, { passes: 0, runs: 3 })).toBe(
      "insufficient-runs",
    );
    expect(verdictFor({ passes: 3, runs: 3 }, { passes: 0, runs: 5 })).toBe(
      "insufficient-runs",
    );
  });
});
