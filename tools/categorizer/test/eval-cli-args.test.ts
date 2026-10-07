import { describe, expect, it } from "vitest";
import { parseEvalArgs } from "../eval/cli";

describe("parseEvalArgs", () => {
  it("defaults: 5 runs, no case filter, no rebaseline, no config", () => {
    const parsed = parseEvalArgs([]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.runs).toBe(5);
    expect(parsed.value.caseId).toBeUndefined();
    expect(parsed.value.rebaseline).toBe(false);
    expect(parsed.value.configPath).toBeNull();
  });

  it("parses the full flag set", () => {
    const parsed = parseEvalArgs([
      "--config",
      "cfg.yaml",
      "--case",
      "button-under-split",
      "--runs",
      "3",
      "--rebaseline",
      "--prices",
      "p.json",
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value).toMatchObject({
      configPath: "cfg.yaml",
      caseId: "button-under-split",
      runs: 3,
      rebaseline: true,
      pricesPath: "p.json",
    });
  });

  it("parses --no-baseline and refuses it alongside --rebaseline", () => {
    const parsed = parseEvalArgs(["--no-baseline"]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.noBaseline).toBe(true);
    expect(parsed.value.rebaseline).toBe(false);
    // Characterize or write a baseline, never both in one run.
    expect(parseEvalArgs(["--no-baseline", "--rebaseline"]).ok).toBe(false);
  });

  it("rejects bad runs values and unknown flags", () => {
    expect(parseEvalArgs(["--runs", "0"]).ok).toBe(false);
    expect(parseEvalArgs(["--runs", "x"]).ok).toBe(false);
    expect(parseEvalArgs(["--frobnicate"]).ok).toBe(false);
    expect(parseEvalArgs(["--case"]).ok).toBe(false);
  });
});
