import { describe, expect, it, vi } from "vitest";
import { isBriefRowId, type BriefSpanRow } from "persistence";
import {
  buildDeltaSpanSets,
  buildNarrativeSpanSets,
  deriveLastReviewComparison,
  derivePreviousBriefComparison,
  spanKey,
} from "./revision-comparisons";

const NO_DELTAS = buildDeltaSpanSets([]);
const NO_NARRATIVES = buildNarrativeSpanSets([]);

function stubNarrativeRow(
  prevHeadSha: string,
  headSha: string,
  unchanged = false,
) {
  return { prevHeadSha, headSha, unchanged };
}

function stubDeltaRow(flags: { skipped?: boolean; unchanged?: boolean }) {
  return {
    baselineSha: "base-sha",
    headSha: "head-sha",
    skipped: flags.skipped ?? false,
    unchanged: flags.unchanged ?? false,
  };
}

function brief(
  headIndex: number,
  headSha: string,
  baseSha = "b0",
): BriefSpanRow {
  const id = BigInt(headIndex + 1);
  if (!isBriefRowId(id)) {
    throw new Error("unbrandable fixture id");
  }
  return {
    id,
    headIndex,
    headSha,
    baseSha,
    createdAt: new Date("2026-08-01T00:00:00Z"),
  };
}

describe("derivePreviousBriefComparison", () => {
  const briefs = [
    brief(0, "h0"),
    brief(1, "h1"),
    brief(2, "h1"),
    brief(3, "h3"),
  ];

  it("picks the highest lower-index brief whose head differs", () => {
    const marks = new Set([spanKey("h1", "h3")]);
    const view = derivePreviousBriefComparison(
      brief(3, "h3"),
      briefs,
      marks,
      NO_NARRATIVES,
      false,
    );
    expect(view).toEqual({
      baselineSha: "h1",
      baselineIndex: 2,
      narrativeAvailable: false,
    });
  });

  it("says the baseline is unavailable when the span has no marks", () => {
    const view = derivePreviousBriefComparison(
      brief(3, "h3"),
      briefs,
      new Set(),
      NO_NARRATIVES,
      false,
    );
    expect(view).toEqual({
      baselineSha: "h1",
      baselineIndex: 2,
      unavailable: "baseline-unavailable",
    });
  });

  it("says pending while the target head's brief still generates", () => {
    const view = derivePreviousBriefComparison(
      brief(3, "h3"),
      briefs,
      new Set(),
      NO_NARRATIVES,
      true,
    );
    expect(view).toEqual({
      baselineSha: "h1",
      baselineIndex: 2,
      unavailable: "pending",
    });
  });

  it("says too large when a narrative record stands without marks", () => {
    const view = derivePreviousBriefComparison(
      brief(3, "h3"),
      briefs,
      new Set(),
      buildNarrativeSpanSets([stubNarrativeRow("h1", "h3")]),
      true,
    );
    expect(view).toEqual({
      baselineSha: "h1",
      baselineIndex: 2,
      unavailable: "span-too-large",
    });
  });

  it("is correct for a historical head, not only the latest", () => {
    const marks = new Set([spanKey("h0", "h1")]);
    const view = derivePreviousBriefComparison(
      brief(1, "h1"),
      briefs,
      marks,
      buildNarrativeSpanSets([stubNarrativeRow("h0", "h1")]),
      false,
    );
    expect(view).toEqual({
      baselineSha: "h0",
      baselineIndex: 0,
      narrativeAvailable: true,
    });
  });

  it("returns undefined for the first brief", () => {
    expect(
      derivePreviousBriefComparison(
        brief(0, "h0"),
        briefs,
        new Set(),
        NO_NARRATIVES,
        false,
      ),
    ).toBeUndefined();
  });

  it("says the span is unchanged when its narrative is the no-change record", () => {
    const view = derivePreviousBriefComparison(
      brief(1, "h1"),
      briefs,
      new Set([spanKey("h0", "h1")]),
      buildNarrativeSpanSets([stubNarrativeRow("h0", "h1", true)]),
      false,
    );
    expect(view).toEqual({
      baselineSha: "h0",
      baselineIndex: 0,
      narrativeAvailable: true,
      unchanged: true,
    });
  });
});

describe("buildDeltaSpanSets", () => {
  it("never offers an unchanged span's record as a Delta Brief", () => {
    const sets = buildDeltaSpanSets([stubDeltaRow({ unchanged: true })]);
    const key = spanKey("base-sha", "head-sha");
    expect([sets.available.has(key), sets.unchanged.has(key)]).toEqual([
      false,
      true,
    ]);
  });
});

describe("deriveLastReviewComparison", () => {
  const briefs = [brief(0, "base-sha"), brief(1, "head-sha")];

  it("is absent with no checkpoint or an empty span", async () => {
    expect(
      await deriveLastReviewComparison(
        "head-sha",
        undefined,
        briefs,
        new Set(),
        NO_DELTAS,
        undefined,
      ),
    ).toBeUndefined();
    expect(
      await deriveLastReviewComparison(
        "head-sha",
        { lastSubmittedSha: "head-sha" },
        briefs,
        new Set(),
        NO_DELTAS,
        undefined,
      ),
    ).toBeUndefined();
  });

  it("offers marks-backed comparisons with delta richness and baseline index", async () => {
    const view = await deriveLastReviewComparison(
      "head-sha",
      { lastSubmittedSha: "base-sha" },
      briefs,
      new Set([spanKey("base-sha", "head-sha")]),
      buildDeltaSpanSets([
        {
          baselineSha: "base-sha",
          headSha: "head-sha",
          skipped: false,
          unchanged: false,
        },
      ]),
      undefined,
    );
    expect(view).toEqual({
      deltaAvailable: true,
      baselineSha: "base-sha",
      baselineIndex: 0,
    });
  });

  it("says a skipped delta is skipped, never available", async () => {
    const view = await deriveLastReviewComparison(
      "head-sha",
      { lastSubmittedSha: "base-sha" },
      briefs,
      new Set([spanKey("base-sha", "head-sha")]),
      buildDeltaSpanSets([
        {
          baselineSha: "base-sha",
          headSha: "head-sha",
          skipped: true,
          unchanged: false,
        },
      ]),
      undefined,
    );
    expect(view).toEqual({
      deltaAvailable: false,
      deltaSkipped: true,
      baselineSha: "base-sha",
      baselineIndex: 0,
    });
  });

  it("says an unchanged span is unchanged, never available", async () => {
    const view = await deriveLastReviewComparison(
      "head-sha",
      { lastSubmittedSha: "base-sha" },
      briefs,
      new Set([spanKey("base-sha", "head-sha")]),
      buildDeltaSpanSets([stubDeltaRow({ unchanged: true })]),
      undefined,
    );
    expect(view).toEqual({
      deltaAvailable: false,
      deltaUnchanged: true,
      baselineSha: "base-sha",
      baselineIndex: 0,
    });
  });

  it("omits baselineIndex when the checkpoint SHA was never a briefed head", async () => {
    const view = await deriveLastReviewComparison(
      "head-sha",
      { lastSubmittedSha: "native-sha" },
      briefs,
      new Set([spanKey("native-sha", "head-sha")]),
      NO_DELTAS,
      undefined,
    );
    expect(view).toEqual({
      deltaAvailable: false,
      baselineSha: "native-sha",
    });
  });

  it("resolves duplicate checkpoint heads to the lowest brief index", async () => {
    const withDuplicates = [
      brief(0, "base-sha"),
      brief(1, "base-sha"),
      brief(2, "head-sha"),
    ];
    const view = await deriveLastReviewComparison(
      "head-sha",
      { lastSubmittedSha: "base-sha" },
      withDuplicates,
      new Set([spanKey("base-sha", "head-sha")]),
      NO_DELTAS,
      undefined,
    );
    expect(view).toEqual({
      deltaAvailable: false,
      baselineSha: "base-sha",
      baselineIndex: 0,
    });
  });

  it("says a refused span is too large instead of probing", async () => {
    const pendingProbe = vi.fn(async () => true);
    const view = await deriveLastReviewComparison(
      "head-sha",
      { lastSubmittedSha: "base-sha" },
      briefs,
      new Set(),
      buildDeltaSpanSets([
        {
          baselineSha: "base-sha",
          headSha: "head-sha",
          skipped: true,
          unchanged: false,
        },
      ]),
      pendingProbe,
    );

    expect(view).toEqual({ unavailable: "span-too-large" });
    expect(pendingProbe).not.toHaveBeenCalled();
  });

  it("reports pending only when the probe says a generation is live", async () => {
    const pendingProbe = vi.fn(async () => true);
    const pending = await deriveLastReviewComparison(
      "head-sha",
      { lastSubmittedSha: "base-sha" },
      briefs,
      new Set(),
      NO_DELTAS,
      pendingProbe,
    );
    expect(pending).toEqual({ unavailable: "pending" });
    const unavailable = await deriveLastReviewComparison(
      "head-sha",
      { lastSubmittedSha: "base-sha" },
      briefs,
      new Set(),
      NO_DELTAS,
      undefined,
    );
    expect(unavailable).toEqual({ unavailable: "baseline-unavailable" });
  });
});
