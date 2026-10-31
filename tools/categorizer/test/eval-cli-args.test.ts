import { describe, expect, it } from "vitest";
import { describeIdleKnobs, listKnobFlags, parseEvalArgs } from "../eval/cli";

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

  it("parses the multi-call knobs", () => {
    const parsed = parseEvalArgs([
      "--force-multi-call",
      "--force-outline",
      "headers",
      "--effort-grouping",
      "high",
      "--effort-detail",
      "low",
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.knobs).toEqual({
      forceMultiCall: true,
      forcedOutlineForm: "headers",
      groupingEffort: "high",
      detailEffort: "low",
    });
  });

  it("knobs default off and never combine with --rebaseline", () => {
    const parsed = parseEvalArgs([]);
    expect(parsed.ok && parsed.value.knobs).toEqual({ forceMultiCall: false });
    expect(parseEvalArgs(["--force-multi-call", "--rebaseline"]).ok).toBe(
      false,
    );
    expect(parseEvalArgs(["--rebaseline", "--effort-detail", "low"]).ok).toBe(
      false,
    );
  });

  it("rejects an unknown outline form or effort", () => {
    expect(parseEvalArgs(["--force-outline", "lines-99"]).ok).toBe(false);
    expect(parseEvalArgs(["--effort-grouping", "max"]).ok).toBe(false);
    expect(parseEvalArgs(["--force-outline"]).ok).toBe(false);
  });

  it("rejects bad runs values and unknown flags", () => {
    expect(parseEvalArgs(["--runs", "0"]).ok).toBe(false);
    expect(parseEvalArgs(["--runs", "x"]).ok).toBe(false);
    expect(parseEvalArgs(["--frobnicate"]).ok).toBe(false);
    expect(parseEvalArgs(["--case"]).ok).toBe(false);
  });
});

const ONE_HUNK_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,1 +1,1 @@",
  "-old",
  "+new",
  "",
].join("\n");

// Past brief-core's single-call hunk ceiling (SINGLE_CALL_MAX_HUNKS, 120).
const OVER_SINGLE_CALL_HUNKS = 130;
const HUNK_LINE_STRIDE = 10;

function makeWideDiff(hunks: number): string {
  const body = Array.from({ length: hunks }, (_, index) => [
    `@@ -${index * HUNK_LINE_STRIDE + 1},1 +${index * HUNK_LINE_STRIDE + 1},1 @@`,
    "-old",
    "+new",
  ]).flat();
  return [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    ...body,
    "",
  ].join("\n");
}

describe("describeIdleKnobs", () => {
  it("names the idle knobs on a one-call case and the flag to add", () => {
    const note = describeIdleKnobs("tiny", ONE_HUNK_DIFF, {
      forceMultiCall: false,
      forcedOutlineForm: "headers",
      detailEffort: "low",
    });

    expect(note).toContain("tiny");
    expect(note).toContain("--force-outline, --effort-detail");
    expect(note).toContain("add --force-multi-call");
  });

  it("says nothing when the knobs take effect or none is set", () => {
    const knobs = {
      forceMultiCall: false,
      forcedOutlineForm: "headers",
    } as const;

    expect(
      describeIdleKnobs("tiny", ONE_HUNK_DIFF, {
        ...knobs,
        forceMultiCall: true,
      }),
    ).toBeUndefined();
    expect(
      describeIdleKnobs("wide", makeWideDiff(OVER_SINGLE_CALL_HUNKS), knobs),
    ).toBeUndefined();
    expect(
      describeIdleKnobs("tiny", ONE_HUNK_DIFF, { forceMultiCall: false }),
    ).toBeUndefined();
  });
});

describe("listKnobFlags", () => {
  it("names every set knob as its flag reads, value included", () => {
    expect(
      listKnobFlags({
        forceMultiCall: true,
        forcedOutlineForm: "headers",
        groupingEffort: "high",
        detailEffort: "low",
      }),
    ).toEqual([
      "--force-multi-call",
      "--force-outline headers",
      "--effort-grouping high",
      "--effort-detail low",
    ]);
  });

  it("is empty on the production path", () => {
    expect(listKnobFlags({ forceMultiCall: false })).toEqual([]);
  });
});
