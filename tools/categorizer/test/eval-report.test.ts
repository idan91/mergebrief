import { describe, expect, it } from "vitest";
import { buildReport, type CaseOutcome } from "../eval/report";

/**
 * Report = the measurement artifact (BRIEF-59 decision 6): terminal text,
 * report JSON, and a paste-ready markdown block. Quiet when clean; the
 * regression count is the only automation input (exit code).
 */

function outcome(overrides: Partial<CaseOutcome> = {}): CaseOutcome {
  return {
    caseId: "button-under-split",
    runsRequested: 5,
    runsScored: 5,
    generationFailures: 0,
    properties: [
      { id: "p1", description: ">=2 groups", check: () => true },
      { id: "p2", description: "scss follows refactor", check: () => true },
    ],
    scores: new Map([
      ["p1", { passes: 5, runs: 5 }],
      ["p2", { passes: 5, runs: 5 }],
    ]),
    baseline: {
      key: "anthropic:m",
      runs: 5,
      properties: { p1: 5, p2: 5 },
    },
    notes: [],
    ...overrides,
  };
}

describe("buildReport", () => {
  it("is quiet when clean: summary line, no verdict lines, zero regressions", () => {
    const report = buildReport({
      key: "anthropic:m",
      billing: { kind: "api" },
      cases: [outcome()],
      usage: {
        calls: 5,
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 0,
      },
      costUsd: null,
    });
    expect(report.regressions).toBe(0);
    expect(report.terminal).toContain("1 case");
    expect(report.terminal).toContain("2 properties");
    expect(report.terminal).toContain("no change vs baseline");
    expect(report.terminal).not.toContain("REGRESSION");
  });

  it("counts and renders regressions, and carries them into the markdown block", () => {
    const report = buildReport({
      key: "anthropic:m",
      billing: { kind: "api" },
      cases: [
        outcome({
          scores: new Map([
            ["p1", { passes: 3, runs: 5 }],
            ["p2", { passes: 5, runs: 5 }],
          ]),
        }),
      ],
      usage: null,
      costUsd: null,
    });
    expect(report.regressions).toBe(1);
    expect(report.terminal).toContain("REGRESSION");
    expect(report.terminal).toContain("p1");
    expect(report.markdown).toContain("REGRESSION");
    expect(
      report.json.cases[0]?.properties.find((p) => p.id === "p1")?.verdict,
    ).toBe("regression");
  });

  it("marks a property absent from the baseline as new — never a verdict, never silent", () => {
    const report = buildReport({
      key: "anthropic:m",
      billing: { kind: "api" },
      cases: [
        outcome({
          baseline: { key: "anthropic:m", runs: 5, properties: { p1: 5 } },
        }),
      ],
      usage: null,
      costUsd: null,
    });
    expect(report.regressions).toBe(0);
    const p2 = report.json.cases[0]?.properties.find((p) => p.id === "p2");
    expect(p2?.verdict).toBe("no-baseline");
    // A partially-baselined case must be visible in the terminal — an
    // unbaselined property could otherwise fail forever without a line.
    expect(report.terminal).toContain("no baseline entry");
    expect(report.terminal).toContain("p2");
    expect(report.terminal).not.toContain("no change vs baseline");
  });

  it("surfaces stale baseline entries that match no property", () => {
    const report = buildReport({
      key: "anthropic:m",
      billing: { kind: "api" },
      cases: [
        outcome({
          baseline: {
            key: "anthropic:m",
            runs: 5,
            properties: { p1: 5, p2: 5, "old-renamed-property": 5 },
          },
        }),
      ],
      usage: null,
      costUsd: null,
    });
    expect(report.terminal).toContain("old-renamed-property");
    expect(report.terminal).toContain("matches no property");
  });

  it("treats a missing baseline file as fully verdictless", () => {
    const report = buildReport({
      key: "anthropic:m",
      billing: { kind: "api" },
      cases: [outcome({ baseline: null })],
      usage: null,
      costUsd: null,
    });
    expect(report.regressions).toBe(0);
    expect(report.terminal).toContain("no baseline");
  });

  it("renders dollars when priced, tokens alone when not, and subscription honestly", () => {
    const priced = buildReport({
      key: "anthropic:m",
      billing: { kind: "api" },
      cases: [outcome()],
      usage: {
        calls: 5,
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
      },
      costUsd: 15,
    });
    expect(priced.terminal).toContain("$15.00");
    const unpriced = buildReport({
      key: "anthropic:m",
      billing: { kind: "api" },
      cases: [outcome()],
      usage: { calls: 5, inputTokens: 42, outputTokens: 7, cacheReadTokens: 0 },
      costUsd: null,
    });
    expect(unpriced.terminal).toContain("42");
    expect(unpriced.terminal).not.toContain("$");
    const subscription = buildReport({
      key: "claude-code:m",
      billing: { kind: "subscription" },
      cases: [outcome()],
      usage: null,
      costUsd: null,
    });
    expect(subscription.terminal).toContain("subscription");
    expect(subscription.terminal).not.toContain("$0");
  });

  it("surfaces generation failures and withholds verdicts on under-scored cases", () => {
    const report = buildReport({
      key: "anthropic:m",
      billing: { kind: "api" },
      cases: [
        outcome({
          runsScored: 3,
          generationFailures: 2,
          scores: new Map([
            ["p1", { passes: 0, runs: 3 }],
            ["p2", { passes: 3, runs: 3 }],
          ]),
        }),
      ],
      usage: null,
      costUsd: null,
    });
    // 0/3 on a stable-pass baseline would be a regression at n=5 — but 3
    // scored runs is below the verdict floor, so no gate fires.
    expect(report.regressions).toBe(0);
    expect(report.terminal).toContain("2 generation failures");
    expect(report.terminal).toMatch(/insufficient-runs/i);
  });
});
