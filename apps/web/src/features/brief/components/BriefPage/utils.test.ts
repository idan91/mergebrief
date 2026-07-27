import { describe, expect, it } from "vitest";

import type { BriefChunk, ComparisonMarks, IntentCheck } from "../../types";
import {
  countComparisonRuns,
  countIntentGaps,
  countIntentTensions,
  disabledComparisonQuery,
} from "./utils";

function intentItem(overrides: { acknowledged?: boolean } = {}) {
  return {
    intent: "an ask",
    quote: "a quote",
    sourceUrl: "",
    groupIds: [],
    acknowledged: overrides.acknowledged ?? false,
  };
}

function intentCheck(overrides: Partial<IntentCheck> = {}): IntentCheck {
  return {
    ticketUrls: [],
    specificity: "precise",
    scopeNote: "",
    accomplished: [],
    statedButMissing: [],
    doneButUnstated: [],
    deviations: [],
    claimedButUnachieved: [],
    ...overrides,
  };
}

describe("countIntentGaps", () => {
  it("returns 0 for a pre-feature Brief (no intent check)", () => {
    expect(countIntentGaps(undefined)).toBe(0);
  });

  it("returns 0 when specificity is not precise, even with items", () => {
    expect(
      countIntentGaps(
        intentCheck({
          specificity: "broad",
          statedButMissing: [intentItem(), intentItem()],
        }),
      ),
    ).toBe(0);
  });

  it("counts stated-but-missing items on a precise check", () => {
    expect(
      countIntentGaps(
        intentCheck({ statedButMissing: [intentItem(), intentItem()] }),
      ),
    ).toBe(2);
  });
});

describe("countIntentTensions", () => {
  it("returns 0 for a pre-feature Brief (no intent check)", () => {
    expect(countIntentTensions(undefined)).toBe(0);
  });

  it("returns 0 when specificity is not precise, even with items", () => {
    expect(
      countIntentTensions(
        intentCheck({
          specificity: "none",
          deviations: [intentItem()],
          claimedButUnachieved: [intentItem()],
        }),
      ),
    ).toBe(0);
  });

  it("counts unacknowledged deviations plus claimed-but-unachieved; acknowledged deviations are excluded", () => {
    expect(
      countIntentTensions(
        intentCheck({
          deviations: [
            intentItem(),
            intentItem({ acknowledged: true }),
            intentItem(),
          ],
          claimedButUnachieved: [intentItem()],
        }),
      ),
    ).toBe(3);
  });
});

function chunk(id: string, file: string): BriefChunk {
  return {
    id,
    changeGroupId: "g1",
    file,
    concern: "implementation",
    role: "carrier",
    loc: { added: 0, deleted: 0 },
    addedRanges: [],
    removedRanges: [],
    riskSurface: [],
    diff: [
      { kind: "hunk", content: "@@" },
      { kind: "ctx", content: "ctx", oldLine: 10, newLine: 10 },
      { kind: "add", content: "added 11", newLine: 11 },
      { kind: "add", content: "added 12", newLine: 12 },
      { kind: "ctx", content: "ctx", oldLine: 11, newLine: 13 },
      { kind: "del", content: "gone", oldLine: 12 },
      { kind: "ctx", content: "ctx", oldLine: 13, newLine: 14 },
    ],
  };
}

const marks: ComparisonMarks = {
  baselineSha: "base",
  headSha: "head",
  baselineLabel: "previous-brief",
  baselineIndex: 0,
  files: [
    {
      file: "src/a.ts",
      addedRanges: [{ start: 11, end: 12 }],
      removedRanges: [{ start: 12, end: 12 }],
    },
  ],
};

describe("countComparisonRuns", () => {
  it("returns 0 without marks", () => {
    expect(countComparisonRuns([chunk("c1", "src/a.ts")], null)).toBe(0);
  });

  it("sums each chunk's contiguous marked runs", () => {
    // The scenario marks rows add@11+add@12 (one contiguous added run) and
    // the standalone deletion old@12 after an unmarked context row (a second
    // run) — 2 runs per matching chunk, 0 for a chunk in an unmarked file.
    expect(countComparisonRuns([chunk("c1", "src/a.ts")], marks)).toBe(2);
    expect(
      countComparisonRuns(
        [chunk("c1", "src/a.ts"), chunk("c2", "src/a.ts")],
        marks,
      ),
    ).toBe(4);
    expect(countComparisonRuns([chunk("c3", "src/other.ts")], marks)).toBe(0);
  });
});

describe("disabledComparisonQuery", () => {
  it("keys on the slot and always rejects", async () => {
    const query = disabledComparisonQuery<string>("marks");
    expect(query.queryKey).toEqual(["comparison-plan-disabled", "marks"]);
    await expect(
      (query.queryFn as () => Promise<string>)(),
    ).rejects.toThrowError("comparison query disabled");
  });
});
