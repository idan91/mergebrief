import { appI18n } from "../../../../i18n/I18nProvider";
import { ViewportBands } from "@web/hooks/useViewportBoundary";
import { describe, expect, it, vi } from "vitest";

import type { ConversationPlan } from "@web/features/conversation";
import type { ProgressTotals } from "../../utils/progress";
import type {
  BriefChunk,
  ComparisonAvailability,
  ComparisonMarks,
  IntentCheck,
  RevisionNarrative,
  RevisionNarrativeSkipped,
} from "../../types";
import {
  conversationGroupIds,
  countComparisonRuns,
  countIntentGaps,
  countIntentTensions,
  deriveBriefProgress,
  deriveChunkSizes,
  deriveRowLandingCorrection,
  disabledComparisonQuery,
  discriminateNarrativeArtifact,
  groupSinceMarkers,
  groupStartIndexes,
  markReadyBatchBusyLabel,
  markReadyBatchFailureCopy,
  resolveLocalComparisonIds,
  resolveRiskEvidence,
  toggleSetMember,
  resolveSidebarLayout,
  SidebarLayouts,
  deriveChunkHash,
  deriveLineHash,
  parseLineHash,
  resolveChunkIdFromHash,
  buildReplyRecordingPlan,
} from "./utils";
import { LineHashErrors } from "./types";
import { CommentSides } from "@web/features/review/utils";

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
    ticketTitles: [],
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

const t = appI18n.t;

describe("countIntentGaps", () => {
  it("returns 0 for a pre-feature Brief with no intent check", () => {
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
  it("returns 0 for a pre-feature Brief with no intent check", () => {
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

  it("counts unacknowledged deviations and claimed-but-unachieved", () => {
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

function stubChunk(id: string, file: string, rowCount: number): BriefChunk {
  return {
    ...chunk(id, file),
    diff: Array.from({ length: rowCount }, () => ({
      kind: "ctx" as const,
      content: "x",
    })),
  };
}

function chunk(id: string, file: string): BriefChunk {
  return {
    id,
    changeGroupId: "g1",
    file,
    concern: "implementation",
    role: "core",
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
    // run): 2 runs per matching chunk, 0 for a chunk in an unmarked file.
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

describe("groupStartIndexes", () => {
  it("returns [] for no groups", () => {
    expect(groupStartIndexes([])).toEqual([]);
  });

  it("maps each group to the index its first chunk holds in the flat order", () => {
    const groups = [
      { chunks: ["a", "b"] },
      { chunks: ["c"] },
      { chunks: ["d", "e", "f"] },
    ];
    expect(groupStartIndexes(groups)).toEqual([0, 2, 3]);
  });
});

describe("deriveBriefProgress", () => {
  const totals: ProgressTotals = {
    reviewed: 1,
    chunkTotal: 4,
    flagsResolved: 2,
    flagTotal: 2,
  };

  it("returns 0 when there is no work at all", () => {
    expect(
      deriveBriefProgress({
        ownDraftActive: false,
        totals: { reviewed: 0, chunkTotal: 0, flagsResolved: 0, flagTotal: 0 },
        flagCount: 0,
      }),
    ).toBe(0);
  });

  it("counts chunks and flag dispositions for a reviewer", () => {
    expect(
      deriveBriefProgress({
        ownDraftActive: false,
        totals,
        flagCount: 2,
      }),
    ).toBe(50);
  });

  it("counts chunk read-through only in the own-draft state", () => {
    expect(
      deriveBriefProgress({
        ownDraftActive: true,
        totals,
        flagCount: 2,
      }),
    ).toBe(25);
  });

  it("stays below 100% until remainder chunks in chunkTotal are read", () => {
    const attributedRead: ProgressTotals = {
      reviewed: 2,
      chunkTotal: 3,
      flagsResolved: 2,
      flagTotal: 2,
    };

    expect(
      deriveBriefProgress({
        ownDraftActive: false,
        totals: attributedRead,
        flagCount: 2,
      }),
    ).toBe(80);

    expect(
      deriveBriefProgress({
        ownDraftActive: false,
        totals: { ...attributedRead, reviewed: 3 },
        flagCount: 2,
      }),
    ).toBe(100);
  });

  it("includes remainder chunks in own-draft read-through", () => {
    expect(
      deriveBriefProgress({
        ownDraftActive: true,
        totals: {
          reviewed: 2,
          chunkTotal: 3,
          flagsResolved: 2,
          flagTotal: 2,
        },
        flagCount: 2,
      }),
    ).toBeCloseTo((2 / 3) * 100);
  });
});

describe("resolveLocalComparisonIds", () => {
  const comparisons: ComparisonAvailability = {
    previousBrief: {
      marksId: "prev-marks",
      narrativeId: "prev-narrative",
      baselineSha: "sha-prev",
      baselineIndex: 0,
    },
    lastReview: {
      marksId: "review-marks",
      deltaId: "review-delta",
      baselineSha: "sha-review",
      baselineIndex: 1,
    },
  };

  it("resolves nothing while Compare is off", () => {
    expect(resolveLocalComparisonIds("off", comparisons)).toEqual({
      marksId: undefined,
      narrativeId: undefined,
      deltaId: undefined,
    });
  });

  it("resolves nothing without a selected point", () => {
    expect(resolveLocalComparisonIds("previous-brief", undefined)).toEqual({
      marksId: undefined,
      narrativeId: undefined,
      deltaId: undefined,
    });
  });

  it("resolves previous-brief marks + narrative, never a delta", () => {
    expect(resolveLocalComparisonIds("previous-brief", comparisons)).toEqual({
      marksId: "prev-marks",
      narrativeId: "prev-narrative",
      deltaId: undefined,
    });
  });

  it("resolves last-review marks + delta, never a narrative", () => {
    expect(resolveLocalComparisonIds("last-review", comparisons)).toEqual({
      marksId: "review-marks",
      narrativeId: undefined,
      deltaId: "review-delta",
    });
  });
});

describe("discriminateNarrativeArtifact", () => {
  const pr = {
    repo: "o/r",
    number: 1,
    title: "t",
    url: "",
    sha: "head",
    description: "",
  };
  const narrative: RevisionNarrative = {
    artifactKind: "revisionNarrative",
    pr,
    prevHeadSha: "prev",
    headSha: "head",
    prevIndex: 0,
    headIndex: 1,
    generation: { provider: "p", model: "m", effort: null },
    overview: "what changed",
    chunks: [],
  };
  const skipped: RevisionNarrativeSkipped = {
    artifactKind: "revisionNarrativeSkipped",
    pr,
    prevHeadSha: "prev",
    headSha: "head",
    prevIndex: 0,
    headIndex: 1,
    skipped: "span too large",
  };

  it("returns neither for an absent artifact", () => {
    expect(discriminateNarrativeArtifact(null)).toEqual({
      narrative: null,
      skipReason: null,
    });
  });

  it("returns the narrative for a real narrative artifact", () => {
    expect(discriminateNarrativeArtifact(narrative)).toEqual({
      narrative,
      skipReason: null,
    });
  });

  it("returns only the skip reason for a skip stub", () => {
    expect(discriminateNarrativeArtifact(skipped)).toEqual({
      narrative: null,
      skipReason: "span too large",
    });
  });
});

describe("markReadyBatchFailureCopy", () => {
  it("always carries honest counts and the NOT-marked-ready suffix", () => {
    for (const cause of [
      "rejected",
      "unauthorized",
      "stale",
      "not-found",
      "indeterminate",
    ] as const) {
      const copy = markReadyBatchFailureCopy(t, 1, 3, cause);
      expect(copy).toContain("Posted 1 of 3.");
      expect(copy).toContain("The PR was NOT marked ready.");
    }
  });

  it("gives the cause's own recovery guidance", () => {
    expect(markReadyBatchFailureCopy(t, 0, 1, "rejected")).toContain(
      "edit the draft and try again",
    );
    expect(markReadyBatchFailureCopy(t, 0, 1, "unauthorized")).toContain(
      "sign in again",
    );
    expect(markReadyBatchFailureCopy(t, 0, 1, "stale")).toContain(
      "reload to post against the current diff",
    );
    expect(markReadyBatchFailureCopy(t, 0, 1, "not-found")).toContain(
      "no longer accessible",
    );
  });

  it("keeps the indeterminate cause indeterminate", () => {
    expect(markReadyBatchFailureCopy(t, 2, 3, "indeterminate")).toContain(
      "may or may not have posted — check GitHub before retrying",
    );
  });
});

describe("markReadyBatchBusyLabel", () => {
  it("returns undefined while no batch runs", () => {
    expect(markReadyBatchBusyLabel(t, null)).toBeUndefined();
  });

  it("labels the running batch's progress", () => {
    expect(markReadyBatchBusyLabel(t, { current: 2, total: 3 })).toBe(
      "Posting 2 of 3…",
    );
  });
});

describe("toggleSetMember", () => {
  it("adds an absent member without mutating the input", () => {
    const current = new Set(["a"]);
    expect(toggleSetMember(current, "b")).toEqual(new Set(["a", "b"]));
    expect(current).toEqual(new Set(["a"]));
  });

  it("removes a present member without mutating the input", () => {
    const current = new Set(["a", "b"]);
    expect(toggleSetMember(current, "b")).toEqual(new Set(["a"]));
    expect(current).toEqual(new Set(["a", "b"]));
  });
});

describe("resolveRiskEvidence", () => {
  it("links the comment when one is chosen", () => {
    expect(
      resolveRiskEvidence("linked-comment", "c1", undefined, "chunk-1"),
    ).toEqual({ kind: "linked-comment", commentId: "c1" });
  });

  it("falls back to chunk-reviewed when linked-comment has no comment", () => {
    expect(
      resolveRiskEvidence("linked-comment", undefined, undefined, "chunk-1"),
    ).toEqual({ kind: "chunk-reviewed", chunkId: "chunk-1" });
  });

  it("anchors chunk-reviewed evidence on the flag's chunk", () => {
    expect(
      resolveRiskEvidence("chunk-reviewed", undefined, undefined, "chunk-1"),
    ).toEqual({ kind: "chunk-reviewed", chunkId: "chunk-1" });
  });

  it("carries the manual note only when one was written", () => {
    expect(
      resolveRiskEvidence("manual-note", undefined, "a note", "chunk-1"),
    ).toEqual({ kind: "manual-note", note: "a note" });
    expect(
      resolveRiskEvidence("manual-note", undefined, undefined, "chunk-1"),
    ).toEqual({ kind: "manual-note" });
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

describe("conversationGroupIds", () => {
  const groups = [
    { id: "g1", chunks: [{ id: "c1" }, { id: "c2" }] },
    { id: "g2", chunks: [{ id: "c3" }] },
  ];

  it("returns the groups whose chunks carry conversation threads", () => {
    const byChunk = new Map([["c3", []]]);
    expect(conversationGroupIds(byChunk, groups)).toEqual(new Set(["g2"]));
  });

  it("returns undefined without a conversation", () => {
    expect(conversationGroupIds(undefined, groups)).toBeUndefined();
  });

  it("returns undefined for an empty digest with no TocBar markers", () => {
    expect(conversationGroupIds(new Map(), groups)).toBeUndefined();
  });
});

describe("groupSinceMarkers", () => {
  const groups = [
    {
      id: "g1",
      chunks: [
        { file: "src/a.ts" },
        { file: "src/a.ts" }, // same file twice, counted once
        { file: "src/b.ts" },
      ],
    },
    { id: "g2", chunks: [{ file: "src/c.ts" }] },
  ];

  it("counts DISTINCT member files with changed ranges per group", () => {
    const sinceMarks = {
      files: [
        {
          file: "src/a.ts",
          addedRanges: [{ start: 1, end: 2 }],
          removedRanges: [],
        },
        {
          file: "src/b.ts",
          addedRanges: [],
          removedRanges: [{ start: 5, end: 5 }],
        },
        {
          file: "src/elsewhere.ts",
          addedRanges: [{ start: 1, end: 1 }],
          removedRanges: [],
        },
      ],
    };
    expect(groupSinceMarkers(groups, sinceMarks)).toEqual(
      new Map([
        ["g1", 2],
        ["g2", 0],
      ]),
    );
  });

  it("ignores a marks entry whose ranges are empty", () => {
    const sinceMarks = {
      files: [{ file: "src/c.ts", addedRanges: [], removedRanges: [] }],
    };
    expect(groupSinceMarkers(groups, sinceMarks)?.get("g2")).toBe(0);
  });

  it("returns undefined without marks, so no checkpoint and no marker", () => {
    expect(groupSinceMarkers(groups, null)).toBeUndefined();
  });
});

describe("resolveSidebarLayout", () => {
  it("reserves the bar below the breakpoint whatever the stored state", () => {
    expect(resolveSidebarLayout(ViewportBands.NARROW, true)).toBe(
      SidebarLayouts.BAR,
    );
    expect(resolveSidebarLayout(ViewportBands.NARROW, false)).toBe(
      SidebarLayouts.BAR,
    );
  });

  it("reserves the column's current width on desktop", () => {
    expect(resolveSidebarLayout(ViewportBands.DESKTOP, true)).toBe(
      SidebarLayouts.EXPANDED,
    );
    expect(resolveSidebarLayout(ViewportBands.DESKTOP, false)).toBe(
      SidebarLayouts.COLLAPSED,
    );
  });
});

describe("deriveChunkSizes", () => {
  it("reports one size per chunk that carries a diff", () => {
    const chunks = [
      stubChunk("a", "src/a.ts", 3),
      stubChunk("b", "src/b.scss", 1),
    ];

    expect(deriveChunkSizes(chunks)).toEqual([
      { file: "src/a.ts", rowCount: 3 },
      { file: "src/b.scss", rowCount: 1 },
    ]);
  });

  it("skips a chunk with no diff rows", () => {
    expect(deriveChunkSizes([stubChunk("a", "src/a.ts", 0)])).toEqual([]);
  });

  it("skips a chunk whose diff never loaded", () => {
    const bare: BriefChunk = { ...chunk("a", "src/a.ts") };
    delete bare.diff;

    expect(deriveChunkSizes([bare])).toEqual([]);
  });
});

describe("chunk deep links", () => {
  it("names a chunk in the hash and reads it back", () => {
    expect(deriveChunkHash("c3")).toBe("#chunk-c3");
    expect(resolveChunkIdFromHash("#chunk-c3")).toBe("c3");
    expect(resolveChunkIdFromHash("#chunk-u-1")).toBe("u-1");
  });

  it("answers undefined for a hash that names no chunk", () => {
    expect(resolveChunkIdFromHash("")).toBeUndefined();
    expect(resolveChunkIdFromHash("#main-content")).toBeUndefined();
    expect(resolveChunkIdFromHash("#chunk-")).toBeUndefined();
    expect(resolveChunkIdFromHash("#chunk-not%20safe")).toBeUndefined();
  });
});

describe("line deep links", () => {
  it("names one new-side line and reads it back", () => {
    const target = {
      file: "src/a.ts",
      side: CommentSides.NEW,
      startLine: 38,
      endLine: 38,
    };
    expect(deriveLineHash(target)).toBe("#src/a.ts:R38");
    expect(parseLineHash("#src/a.ts:R38")).toEqual({ ok: true, value: target });
  });

  it("names a same-side range with the letter on both ends", () => {
    const target = {
      file: "src/a.ts",
      side: CommentSides.OLD,
      startLine: 12,
      endLine: 20,
    };
    expect(deriveLineHash(target)).toBe("#src/a.ts:L12-L20");
    expect(parseLineHash("#src/a.ts:L12-L20")).toEqual({
      ok: true,
      value: target,
    });
  });

  it("carries both sides of a crossing range", () => {
    const target = {
      file: "src/a.ts",
      side: CommentSides.NEW,
      startSide: CommentSides.OLD,
      startLine: 12,
      endLine: 20,
    };
    expect(deriveLineHash(target)).toBe("#src/a.ts:L12-R20");
    expect(parseLineHash("#src/a.ts:L12-R20")).toEqual({
      ok: true,
      value: target,
    });
  });

  it("encodes only hash, query, percent and whitespace in the path", () => {
    const file = "docs/a b#c?d%e.md";
    const hash = deriveLineHash({
      file,
      side: CommentSides.NEW,
      startLine: 1,
      endLine: 1,
    });
    expect(hash).toBe("#docs/a%20b%23c%3Fd%25e.md:R1");
    expect(parseLineHash(hash)).toMatchObject({ ok: true, value: { file } });
    expect(
      deriveLineHash({
        file: "src/[id]/route.ts",
        side: CommentSides.NEW,
        startLine: 1,
        endLine: 1,
      }),
    ).toBe("#src/[id]/route.ts:R1");
  });

  it("keeps a colon in the path by splitting on the last one", () => {
    expect(parseLineHash("#c:/x/y.ts:R3")).toMatchObject({
      ok: true,
      value: { file: "c:/x/y.ts", startLine: 3 },
    });
  });

  it("leaves a chunk hash and a bare hash to their own readers", () => {
    expect(parseLineHash("#chunk-c3")).toEqual({
      ok: false,
      error: LineHashErrors.NOT_LINE_HASH,
    });
    expect(parseLineHash("")).toEqual({
      ok: false,
      error: LineHashErrors.NOT_LINE_HASH,
    });
    expect(parseLineHash("#main-content")).toEqual({
      ok: false,
      error: LineHashErrors.NOT_LINE_HASH,
    });
  });

  it("rejects a malformed line part", () => {
    for (const hash of [
      "#src/a.ts:X12",
      "#src/a.ts:R0",
      "#src/a.ts:R12-",
      "#src/a.ts:R20-R12",
      "#:R12",
      "#src/a.ts:R1.5",
    ]) {
      expect(parseLineHash(hash)).toEqual({
        ok: false,
        error: LineHashErrors.MALFORMED,
      });
    }
  });
});

describe("deriveRowLandingCorrection", () => {
  // Viewport 1000 under a 190px pinned stack: the band is 190 to 1000, middle 595.
  it("leaves a row that fits between the stack and the viewport bottom", () => {
    expect(
      deriveRowLandingCorrection({ top: 400, bottom: 444 }, 190, 1000),
    ).toBe(0);
  });

  it("moves a row parked under the pinned stack just clear of it", () => {
    expect(
      deriveRowLandingCorrection({ top: 141, bottom: 185 }, 190, 1000),
    ).toBe(-65);
  });

  it("moves a row past the viewport bottom just clear of it", () => {
    expect(
      deriveRowLandingCorrection({ top: 980, bottom: 1024 }, 190, 1000),
    ).toBe(40);
  });

  it("moves three clipped pixels by little more than three pixels", () => {
    expect(
      deriveRowLandingCorrection({ top: 187, bottom: 487 }, 190, 1000),
    ).toBe(-19);
  });

  it("leaves a tall row whose head is already in the upper band", () => {
    expect(
      deriveRowLandingCorrection({ top: 200, bottom: 1100 }, 190, 1000),
    ).toBe(0);
  });

  it("puts a tall row's head under the stack, never centres it", () => {
    expect(
      deriveRowLandingCorrection({ top: 50, bottom: 950 }, 190, 1000),
    ).toBe(-156);
  });

  it("pulls up a tall row whose head sits low in the band", () => {
    expect(
      deriveRowLandingCorrection({ top: 800, bottom: 1700 }, 190, 1000),
    ).toBe(594);
  });
});

describe("buildReplyRecordingPlan", () => {
  function stubPlan(
    postReply: ConversationPlan["postReply"],
  ): ConversationPlan {
    // Structural stand-in: only postReply is exercised.
    return { postReply } as unknown as ConversationPlan;
  }

  it("records the wrapping review id of a posted reply", async () => {
    const record = vi.fn();
    const plan = buildReplyRecordingPlan(
      stubPlan(async () => ({ kind: "posted", commentId: 9, reviewId: 555 })),
      record,
    );

    await expect(plan.postReply(1, "x")).resolves.toEqual({
      kind: "posted",
      commentId: 9,
      reviewId: 555,
    });
    expect(record).toHaveBeenCalledWith(555);
  });

  it("records nothing for a failure or a reply without a review id", async () => {
    const record = vi.fn();
    const failed = buildReplyRecordingPlan(
      stubPlan(async () => ({ kind: "upstream" })),
      record,
    );
    const unwrapped = buildReplyRecordingPlan(
      stubPlan(async () => ({ kind: "posted", commentId: 9 })),
      record,
    );

    await failed.postReply(1, "x");
    await unwrapped.postReply(1, "x");

    expect(record).not.toHaveBeenCalled();
  });
});
