import type { LocalBriefSummary } from "contract";
import { describe, expect, it } from "vitest";
import {
  FIRST_SHA,
  SECOND_ID,
  SECOND_SHA,
  STEM,
} from "../../../../test/local-briefs-fixtures";
import type { ComparisonSources } from "../types";
import {
  attachComparisons,
  buildComparisonAvailability,
  deriveBriefStem,
} from "./comparisons";

const SECOND: LocalBriefSummary = {
  id: SECOND_ID,
  artifactKind: "brief",
  repo: "example/repo",
  number: 99,
  title: "Second",
  sha: SECOND_SHA,
  index: 2,
};

const NO_SOURCES: ComparisonSources = {
  summaries: [],
  deltaRecords: [],
  marks: [],
  legacy: [],
  narrativeIds: new Set(),
};

describe("deriveBriefStem", () => {
  it("strips the categorizer's index and short-sha suffix", () => {
    expect(deriveBriefStem(SECOND)).toBe(STEM);
  });

  it("has no stem without an index or with a foreign suffix", () => {
    const { index: _index, ...unindexed } = SECOND;
    expect(deriveBriefStem(unindexed)).toBeUndefined();
    expect(deriveBriefStem({ ...SECOND, id: "renamed" })).toBeUndefined();
  });
});

describe("buildComparisonAvailability", () => {
  it("offers nothing without marks or a legacy sidecar", () => {
    expect(buildComparisonAvailability(SECOND, NO_SOURCES)).toBeUndefined();
  });

  it("ignores Previous Brief marks with no baseline index", () => {
    const sources: ComparisonSources = {
      ...NO_SOURCES,
      marks: [
        {
          id: `${STEM}_2_previous-brief`,
          baselineSha: FIRST_SHA,
          headSha: SECOND_SHA,
          baselineLabel: "previous-brief",
          baselineIndex: null,
        },
      ],
    };

    expect(buildComparisonAvailability(SECOND, sources)).toBeUndefined();
  });
});

describe("attachComparisons", () => {
  it("leaves a Delta row untouched", () => {
    const delta: LocalBriefSummary = { ...SECOND, artifactKind: "delta" };

    expect(attachComparisons(delta, NO_SOURCES)).toBe(delta);
  });
});
