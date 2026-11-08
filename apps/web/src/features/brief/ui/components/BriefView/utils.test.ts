import type {
  IntentCheck,
  RevisionNarrative,
  RevisionNarrativeSkipped,
  RevisionNarrativeUnchanged,
} from "brief-core/types";
import { appI18n } from "../../../../../i18n/I18nProvider";
import { ViewportBands } from "@web/hooks/useViewportBoundary";
import { describe, expect, it, vi } from "vitest";
import { DiffViews } from "@web/components/DiffRows/types";

import type { ConversationPlan } from "@web/features/conversation";
import type { ProgressTotals } from "../../utils/progress";
import type { BriefChunk, ComparisonMarks } from "../../../model/types";
import { GroupViewKinds } from "../../../model/utils/remainder";
import { stubLazyDiff } from "../../../test-utils/fixtures";
import {
  buildRepoPolicyCaption,
  conversationGroupIds,
  countComparisonRuns,
  countIntentGaps,
  countIntentTensions,
  deriveBriefProgress,
  deriveChunkSizes,
  deriveComposerDisabledReason,
  deriveConversationReadOnly,
  deriveSinceMarkers,
  deriveWritesDisabledReason,
  disabledComparisonQuery,
  discriminateNarrativeArtifact,
  groupSinceMarkers,
  groupStartIndexes,
  hasRemovedLines,
  listChunkIds,
  listInitiallyOpenChunkIds,
  listLargeChunkIds,
  markReadyBatchBusyLabel,
  markReadyBatchFailureCopy,
  composeMarkReadyStopCopy,
  deriveMarkReadyStopReason,
  openMarkReadyFlow,
  closeMarkReadyFlow,
  startMarkReadyFlowBatch,
  advanceMarkReadyFlowBatch,
  isMarkReadyGateMounted,
  resolveRiskEvidence,
  toggleSetMember,
  resolveSidebarLayout,
  SidebarLayouts,
  deriveLineLink,
  deriveShareUrl,
  parseLinkParam,
  resolveLinkChunkId,
  buildReplyRecordingPlan,
  resolveDiffViewToggle,
  splitFilePath,
  buildAnnouncedRevisionNav,
  resolveChunkView,
  resolveChunkGithubUrl,
} from "./utils";
import {
  NO_REVIEW_REASON_KEY,
  OWN_DRAFT_STALE_COMPOSER_REASON_KEY,
  SESSION_FROZEN_REASON_KEY,
} from "./consts";
import {
  LinkParamErrors,
  MarkReadyStopReasons,
  type MarkReadyFlow,
} from "./types";
import { DiffSides } from "types/comments";

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
    maskedFixes: [],
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
          maskedFixes: [intentItem()],
        }),
      ),
    ).toBe(0);
  });

  it("counts unacknowledged deviations and masked fixes", () => {
    expect(
      countIntentTensions(
        intentCheck({
          deviations: [
            intentItem(),
            intentItem({ acknowledged: true }),
            intentItem(),
          ],
          maskedFixes: [intentItem()],
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

  it("never reads the rows of a chunk whose file has no marks", () => {
    const { entry: unmarked, reads } = stubLazyDiff(
      chunk("c3", "src/other.ts"),
    );

    expect(countComparisonRuns([unmarked], marks)).toBe(0);
    expect(reads()).toBe(0);
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

describe("listChunkIds", () => {
  it("lists chunk ids group by group in reading order", () => {
    const groups = [
      { chunks: [{ id: "c2" }, { id: "c1" }] },
      { chunks: [] },
      { chunks: [{ id: "c3" }] },
    ];
    expect(listChunkIds(groups)).toEqual(["c2", "c1", "c3"]);
  });
});

describe("listInitiallyOpenChunkIds", () => {
  it("leaves out a chunk past the large-diff limit", () => {
    const groups = [
      {
        chunks: [
          { id: "small", loc: { added: 12, deleted: 3 } },
          { id: "at-limit", loc: { added: 700, deleted: 50 } },
          { id: "past-limit", loc: { added: 700, deleted: 51 } },
        ],
      },
      { chunks: [{ id: "lockfile", loc: { added: 2_140, deleted: 0 } }] },
    ];

    expect(listInitiallyOpenChunkIds(groups)).toEqual(["small", "at-limit"]);
  });
});

describe("listLargeChunkIds", () => {
  it("collects only the chunks past the large-diff limit", () => {
    const chunks = [
      { id: "at-limit", loc: { added: 700, deleted: 50 } },
      { id: "past-limit", loc: { added: 700, deleted: 51 } },
      { id: "lockfile", loc: { added: 2_140, deleted: 0 } },
    ];

    expect([...listLargeChunkIds(chunks)]).toEqual(["past-limit", "lockfile"]);
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

  it("reports removed lines only when a chunk names some", () => {
    const removed = { start: 3, end: 4 };
    const removing = {
      id: "rc1",
      briefChangeGroupId: "g1",
      file: "src/a.ts",
      addedRanges: [],
      removedRanges: [removed],
      summary: "s",
    };

    expect(hasRemovedLines(null)).toBe(false);
    expect(hasRemovedLines(narrative)).toBe(false);
    expect(hasRemovedLines({ ...narrative, chunks: [removing] })).toBe(true);
  });

  it("returns neither for an absent artifact", () => {
    expect(discriminateNarrativeArtifact(null)).toEqual({
      narrative: null,
      skipReason: null,
      isUnchanged: false,
    });
  });

  it("returns the narrative for a real narrative artifact", () => {
    expect(discriminateNarrativeArtifact(narrative)).toEqual({
      narrative,
      skipReason: null,
      isUnchanged: false,
    });
  });

  it("returns only the skip reason for a skip stub", () => {
    expect(discriminateNarrativeArtifact(skipped)).toEqual({
      narrative: null,
      skipReason: "span too large",
      isUnchanged: false,
    });
  });

  it("returns only the unchanged flag for a no-change record", () => {
    const { skipped: _reason, ...unchangedFields } = skipped;
    const unchanged: RevisionNarrativeUnchanged = {
      ...unchangedFields,
      artifactKind: "revisionNarrativeUnchanged",
    };

    expect(discriminateNarrativeArtifact(unchanged)).toEqual({
      narrative: null,
      skipReason: null,
      isUnchanged: true,
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
      expect(copy).toContain("The pull request was not marked ready.");
    }
  });

  it("gives the cause's own recovery guidance", () => {
    expect(markReadyBatchFailureCopy(t, 0, 1, "rejected")).toContain(
      "Edit the draft and try again",
    );
    expect(markReadyBatchFailureCopy(t, 0, 1, "no-permission")).toContain(
      "Check your access on GitHub.",
    );
    expect(markReadyBatchFailureCopy(t, 0, 1, "unauthorized")).toContain(
      "Sign in again",
    );
    expect(markReadyBatchFailureCopy(t, 0, 1, "stale")).toContain(
      "Reload to post against the current diff",
    );
    expect(markReadyBatchFailureCopy(t, 0, 1, "not-found")).toContain(
      "no longer accessible",
    );
  });

  it("keeps the indeterminate cause indeterminate", () => {
    expect(markReadyBatchFailureCopy(t, 2, 3, "indeterminate")).toContain(
      "may or may not have posted. Check GitHub before retrying",
    );
  });
});

const CLOSED_FLOW: MarkReadyFlow = { kind: "closed" };
const GATE_FLOW: MarkReadyFlow = { kind: "gate" };
const POSTING_FLOW: MarkReadyFlow = {
  kind: "posting",
  current: 2,
  total: 3,
  token: 7,
};

describe("markReadyBatchBusyLabel", () => {
  it("returns undefined while no batch runs", () => {
    expect(markReadyBatchBusyLabel(t, GATE_FLOW)).toBeUndefined();
  });

  it("labels the running batch's progress", () => {
    expect(markReadyBatchBusyLabel(t, POSTING_FLOW)).toBe("Posting 2 of 3…");
  });
});

describe("mark-ready flow transitions", () => {
  it("opens a closed gate and never resets a running batch", () => {
    expect(openMarkReadyFlow(CLOSED_FLOW)).toEqual(GATE_FLOW);
    expect(openMarkReadyFlow(POSTING_FLOW)).toBe(POSTING_FLOW);
  });

  it("closes from any state, keeping a closed flow as it is", () => {
    expect(closeMarkReadyFlow(POSTING_FLOW)).toEqual(CLOSED_FLOW);
    expect(closeMarkReadyFlow(CLOSED_FLOW)).toBe(CLOSED_FLOW);
  });

  it("starts a batch only from the open gate", () => {
    expect(startMarkReadyFlowBatch(GATE_FLOW, 3, 4)).toEqual({
      kind: "posting",
      current: 1,
      total: 4,
      token: 3,
    });
    expect(startMarkReadyFlowBatch(CLOSED_FLOW, 3, 4)).toBe(CLOSED_FLOW);
    expect(startMarkReadyFlowBatch(POSTING_FLOW, 3, 4)).toBe(POSTING_FLOW);
  });

  it("advances only the batch whose token is current", () => {
    expect(advanceMarkReadyFlowBatch(POSTING_FLOW, 7, 3)).toEqual({
      kind: "posting",
      current: 3,
      total: 3,
      token: 7,
    });
    expect(advanceMarkReadyFlowBatch(POSTING_FLOW, 6, 3)).toBe(POSTING_FLOW);
    expect(advanceMarkReadyFlowBatch(POSTING_FLOW, 7, 2)).toBe(POSTING_FLOW);
    expect(advanceMarkReadyFlowBatch(CLOSED_FLOW, 7, 3)).toBe(CLOSED_FLOW);
  });
});

describe("isMarkReadyGateMounted", () => {
  const base = {
    ownDraftActive: true,
    markReadyAvailable: true,
    flagCount: 0,
    unpostedDraftCount: 0,
  };

  it("keeps a zero-flag gate mounted while its last draft posts", () => {
    expect(isMarkReadyGateMounted({ ...base, flow: POSTING_FLOW })).toBe(true);
    expect(isMarkReadyGateMounted({ ...base, flow: GATE_FLOW })).toBe(false);
  });

  it("never mounts once the action is withheld", () => {
    expect(
      isMarkReadyGateMounted({
        ...base,
        markReadyAvailable: false,
        flagCount: 2,
        flow: POSTING_FLOW,
      }),
    ).toBe(false);
  });
});

describe("deriveMarkReadyStopReason", () => {
  const signals = {
    briefLeft: false,
    ownDraftActive: true,
    markReadyAvailable: false,
  };

  it("reads a withheld action as an advanced head", () => {
    expect(deriveMarkReadyStopReason(signals)).toBe("head-advanced");
  });

  it("reads a closed own-draft state as ready elsewhere", () => {
    expect(
      deriveMarkReadyStopReason({ ...signals, ownDraftActive: false }),
    ).toBe("ready-elsewhere");
  });

  it("reads every signal unchanged as leaving the Brief", () => {
    expect(
      deriveMarkReadyStopReason({
        briefLeft: false,
        ownDraftActive: true,
        markReadyAvailable: true,
      }),
    ).toBe("brief-left");
  });

  it("reads a swapped Brief as leaving it, whatever else changed", () => {
    expect(
      deriveMarkReadyStopReason({
        briefLeft: true,
        ownDraftActive: false,
        markReadyAvailable: false,
      }),
    ).toBe("brief-left");
  });
});

describe("composeMarkReadyStopCopy", () => {
  it("leads with the head advance and says it was not marked ready", () => {
    expect(
      composeMarkReadyStopCopy(t, {
        reason: MarkReadyStopReasons.HEAD_ADVANCED,
        posted: 1,
        total: 3,
      }),
    ).toBe(
      "This pull request has newer commits. Switch to the latest revision" +
        " to mark it ready for review. Posted 1 of 3. The pull request was" +
        " not marked ready.",
    );
  });

  it("drops the not-ready suffix when the PR went ready elsewhere", () => {
    expect(
      composeMarkReadyStopCopy(t, {
        reason: MarkReadyStopReasons.READY_ELSEWHERE,
        posted: 0,
        total: 2,
        cause: "indeterminate",
      }),
    ).toBe(
      "This pull request is now ready for review, so the pre-ready check" +
        " closed. Posted 0 of 2. One comment may or may not have posted." +
        " Check GitHub before retrying.",
    );
  });

  it("states only the counts when the batch's Brief was left", () => {
    expect(
      composeMarkReadyStopCopy(t, {
        reason: MarkReadyStopReasons.BRIEF_LEFT,
        posted: 2,
        total: 2,
      }),
    ).toBe("Posted 2 of 2. The pull request was not marked ready.");
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

const STORED_TWELVE_ROWS = {
  rows: 12,
  hunkRows: 1,
  expandRows: 0,
  splitRows: 12,
  lineWidths: {
    counts: [12, 0, 0, 0, 0, 0, 0, 0, 0],
    overflowColumns: 0,
  },
};

describe("deriveChunkSizes", () => {
  it("sizes a pending remainder card from its file's stored count", () => {
    const remainder: BriefChunk = {
      ...chunk("u-0badf00d", "src/orphan.ts"),
      changeGroupId: GroupViewKinds.UNATTRIBUTED_REMAINDER,
    };
    delete remainder.diff;
    const counts = {
      chunks: new Map(),
      files: new Map([["src/orphan.ts", STORED_TWELVE_ROWS]]),
    };

    expect(deriveChunkSizes([remainder], counts)).toEqual([
      { file: "src/orphan.ts", rowCount: 12 },
    ]);
  });

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

  it("reads the stored count before the diff lands and over it after", () => {
    const bare: BriefChunk = { ...chunk("a", "src/a.ts") };
    delete bare.diff;
    const counts = {
      chunks: new Map([["a", STORED_TWELVE_ROWS]]),
      files: new Map(),
    };

    expect(deriveChunkSizes([bare], counts)).toEqual([
      { file: "src/a.ts", rowCount: 12 },
    ]);
    expect(deriveChunkSizes([stubChunk("a", "src/a.ts", 3)], counts)).toEqual([
      { file: "src/a.ts", rowCount: 12 },
    ]);
    expect(deriveChunkSizes([stubChunk("b", "src/b.ts", 3)], counts)).toEqual([
      { file: "src/b.ts", rowCount: 3 },
    ]);
  });
});

describe("deriveShareUrl", () => {
  it("sets the link param on the page address, other params kept", () => {
    expect(
      deriveShareUrl(
        { href: "https://brief.test/repos/1/pulls/2?rev=3&view=full" },
        "c3.R12",
      ),
    ).toBe("https://brief.test/repos/1/pulls/2?rev=3&view=full&l=c3.R12");
  });

  it("leaves the thread target behind, so the link lands", () => {
    expect(
      deriveShareUrl(
        { href: "https://brief.test/repos/1/pulls/2?rev=3&thread=55" },
        "c3.R12",
      ),
    ).toBe("https://brief.test/repos/1/pulls/2?rev=3&l=c3.R12");
  });

  it("replaces a link already there and drops a fragment", () => {
    expect(
      deriveShareUrl(
        { href: "https://brief.test/repos/1/pulls/2?l=c1&rev=3#main-content" },
        "c2",
      ),
    ).toBe("https://brief.test/repos/1/pulls/2?l=c2&rev=3");
  });
});

describe("link param", () => {
  it("names a chunk", () => {
    expect(parseLinkParam("c3")).toEqual({
      ok: true,
      value: { kind: "chunk", chunkId: "c3" },
    });
    expect(parseLinkParam("u-7e7f21ef")).toEqual({
      ok: true,
      value: { kind: "chunk", chunkId: "u-7e7f21ef" },
    });
  });

  it("names one new-side line and reads it back", () => {
    const target = {
      chunkId: "c3",
      side: DiffSides.NEW,
      startLine: 38,
      endLine: 38,
    };
    expect(deriveLineLink(target)).toBe("c3.R38");
    expect(parseLinkParam("c3.R38")).toEqual({
      ok: true,
      value: { kind: "lines", lines: target },
    });
  });

  it("names a same-side range with the letter on both ends", () => {
    const target = {
      chunkId: "c3",
      side: DiffSides.OLD,
      startLine: 12,
      endLine: 20,
    };
    expect(deriveLineLink(target)).toBe("c3.L12-L20");
    expect(parseLinkParam("c3.L12-L20")).toEqual({
      ok: true,
      value: { kind: "lines", lines: target },
    });
  });

  it("carries both sides of a crossing range", () => {
    const target = {
      chunkId: "c3",
      side: DiffSides.NEW,
      startSide: DiffSides.OLD,
      startLine: 12,
      endLine: 20,
    };
    expect(deriveLineLink(target)).toBe("c3.L12-R20");
    expect(parseLinkParam("c3.L12-R20")).toEqual({
      ok: true,
      value: { kind: "lines", lines: target },
    });
  });

  it("keeps a dot in the chunk id by splitting on the last one", () => {
    expect(parseLinkParam("c1.2.R3")).toMatchObject({
      ok: true,
      value: { kind: "lines", lines: { chunkId: "c1.2", startLine: 3 } },
    });
    expect(parseLinkParam("c1.2")).toEqual({
      ok: true,
      value: { kind: "chunk", chunkId: "c1.2" },
    });
  });

  it("reads a bad line part as a chunk id, which no brief carries", () => {
    for (const link of ["c3.X12", "c3.R0", "c3.R12-", "c3.R20-R12", ".R12"]) {
      expect(parseLinkParam(link)).toEqual({
        ok: true,
        value: { kind: "chunk", chunkId: link },
      });
    }
  });

  it("rejects characters the param cannot carry", () => {
    for (const link of ["", "c3:R12", "src/a.ts.R1", "c3 .R1"]) {
      expect(parseLinkParam(link)).toEqual({
        ok: false,
        error: LinkParamErrors.MALFORMED,
      });
    }
  });
});

describe("buildReplyRecordingPlan", () => {
  function stubPlan(
    postReply: ConversationPlan["postReply"],
  ): ConversationPlan {
    // Structural stand-in: only postReply is exercised.
    return { postReply } as unknown as ConversationPlan;
  }

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

describe("resolveLinkChunkId", () => {
  it("names the chunk of a chunk link and of a line link", () => {
    expect(resolveLinkChunkId("c2")).toBe("c2");
    expect(resolveLinkChunkId("c3.R38")).toBe("c3");
  });

  it("names nothing without a well-formed link", () => {
    expect(resolveLinkChunkId(undefined)).toBeUndefined();
    expect(resolveLinkChunkId("")).toBeUndefined();
  });
});

describe("splitFilePath", () => {
  it("splits the directory into slash-ended parts and the basename", () => {
    expect(splitFilePath("apps/web/Header.tsx")).toEqual({
      directories: [
        { key: "apps/", text: "apps/" },
        { key: "apps/web/", text: "web/" },
      ],
      basename: "Header.tsx",
    });
  });

  it("shows a bidi override in a path as a visible escape", () => {
    expect(splitFilePath("src/\u202Etxt.exe")).toEqual({
      directories: [{ key: "src/", text: "src/" }],
      basename: "[U+202E]txt.exe",
    });
  });

  it("keeps Hebrew letters in a path as they are", () => {
    expect(splitFilePath("docs/שלום.md").basename).toBe("שלום.md");
  });

  it("has no directory parts for a root file", () => {
    expect(splitFilePath("README.md")).toEqual({
      directories: [],
      basename: "README.md",
    });
  });
});

describe("deriveSinceMarkers", () => {
  const groups = [{ id: "g1", chunks: [{ file: "src/a.ts" }] }];
  const files = [
    {
      file: "src/a.ts",
      addedRanges: [{ start: 1, end: 2 }],
      removedRanges: [],
    },
  ];

  it("counts changed files per group under the short baseline sha", () => {
    const markers = deriveSinceMarkers(groups, {
      baselineSha: "0123456789abcdef",
      files,
    });
    expect(markers?.baselineShortSha).toBe("0123456");
    expect(markers?.counts.get("g1")).toBe(1);
  });

  it("is absent without a last-review checkpoint", () => {
    expect(deriveSinceMarkers(groups, null)).toBeUndefined();
  });
});

describe("deriveWritesDisabledReason", () => {
  it("names the missing review first", () => {
    expect(deriveWritesDisabledReason(t, undefined, true)).toBe(
      t(NO_REVIEW_REASON_KEY),
    );
  });

  it("prefers the read-only reason over a frozen session", () => {
    const review = { readOnly: { reason: "base moved" } };
    expect(deriveWritesDisabledReason(t, review, true)).toBe("base moved");
  });

  it("names a frozen session when the review is writable", () => {
    expect(deriveWritesDisabledReason(t, {}, true)).toBe(
      t(SESSION_FROZEN_REASON_KEY),
    );
  });

  it("is absent while writes are live", () => {
    expect(deriveWritesDisabledReason(t, {}, false)).toBeUndefined();
  });
});

describe("deriveComposerDisabledReason", () => {
  it("keeps the writes reason when there is one", () => {
    expect(deriveComposerDisabledReason(t, "frozen", true)).toBe("frozen");
  });

  it("blocks a stale own draft with its own reason", () => {
    expect(deriveComposerDisabledReason(t, undefined, true)).toBe(
      t(OWN_DRAFT_STALE_COMPOSER_REASON_KEY),
    );
  });

  it("is absent on a live view", () => {
    expect(deriveComposerDisabledReason(t, undefined, false)).toBeUndefined();
  });
});

describe("deriveConversationReadOnly", () => {
  it("carries the writes reason to the section", () => {
    expect(deriveConversationReadOnly("frozen")).toEqual({
      readOnlyReason: "frozen",
    });
  });

  it("carries nothing while writes are live", () => {
    expect(deriveConversationReadOnly(undefined)).toEqual({});
  });
});

describe("resolveDiffViewToggle", () => {
  function stubToggle(view: "split" | "unified", inChangesScope: boolean) {
    const setView = vi.fn();
    const announce = vi.fn();
    const toggle = resolveDiffViewToggle({
      t,
      view,
      setView,
      announce,
      inChangesScope,
    });
    return { toggle, setView, announce };
  }

  it("flips unified to split and announces the split view", () => {
    const { toggle, setView, announce } = stubToggle("unified", false);
    toggle?.();
    expect(setView).toHaveBeenCalledWith("split");
    expect(announce).toHaveBeenCalledWith(t("brief.diff.viewSplit"));
  });

  it("flips split to unified and announces the unified view", () => {
    const { toggle, setView, announce } = stubToggle("split", false);
    toggle?.();
    expect(setView).toHaveBeenCalledWith("unified");
    expect(announce).toHaveBeenCalledWith(t("brief.diff.viewUnified"));
  });

  it("stands down in the Changes scope", () => {
    expect(stubToggle("unified", true).toggle).toBeUndefined();
  });
});

describe("buildAnnouncedRevisionNav", () => {
  function stubNav(wrapped: boolean) {
    const announceQuietly = vi.fn();
    const revisionNav = buildAnnouncedRevisionNav({
      t,
      revisionNav: {
        jumpNext: () => ({ index: 0, wrapped }),
        jumpPrev: () => ({ index: 4, wrapped }),
      },
      announceQuietly,
    });
    return { revisionNav, announceQuietly };
  }

  it("announces a forward wrap to the first change", () => {
    const { revisionNav, announceQuietly } = stubNav(true);
    revisionNav.jumpNext();
    expect(announceQuietly).toHaveBeenCalledWith(
      t("brief.toolbar.changeStepperWrappedToFirst"),
    );
  });

  it("announces a backward wrap to the last change", () => {
    const { revisionNav, announceQuietly } = stubNav(true);
    revisionNav.jumpPrev();
    expect(announceQuietly).toHaveBeenCalledWith(
      t("brief.toolbar.changeStepperWrappedToLast"),
    );
  });

  it("stays quiet on a step that does not wrap", () => {
    const { revisionNav, announceQuietly } = stubNav(false);
    revisionNav.jumpNext();
    revisionNav.jumpPrev();
    expect(announceQuietly).not.toHaveBeenCalled();
  });
});

describe("buildRepoPolicyCaption", () => {
  it("is absent for a built-in attribute shown at full weight", () => {
    expect(
      buildRepoPolicyCaption(t, { source: "built-in", deEmphasized: false }),
    ).toBeUndefined();
  });

  it("opens a lone de-emphasis caption in sentence case", () => {
    expect(
      buildRepoPolicyCaption(t, { source: "built-in", deEmphasized: true }),
    ).toBe("De-emphasized by repo policy");
  });

  it("lowers the de-emphasis caption after the policy lead", () => {
    expect(
      buildRepoPolicyCaption(t, { source: "repo-policy", deEmphasized: true }),
    ).toBe("Defined by repo policy · de-emphasized by repo policy");
  });

  it("carries the repo's implication after the policy lead", () => {
    expect(
      buildRepoPolicyCaption(t, {
        source: "repo-policy",
        deEmphasized: false,
        implication: "Logs must not carry PII",
      }),
    ).toMatch(/^Defined by repo policy.+Logs must not carry PII$/);
  });
});

describe("resolveChunkView", () => {
  const twoSided = {
    addedRanges: [{ start: 10, end: 11 }],
    removedRanges: [{ start: 10, end: 10 }],
  };
  const addedOnly = {
    addedRanges: [{ start: 10, end: 11 }],
    removedRanges: [],
  };

  it("splits a chunk with a line on each side when split is asked for", () => {
    expect(resolveChunkView(DiffViews.SPLIT, twoSided, false)).toBe(
      DiffViews.SPLIT,
    );
  });

  it("keeps a one-sided chunk unified under a split request", () => {
    expect(resolveChunkView(DiffViews.SPLIT, addedOnly, false)).toBe(
      DiffViews.UNIFIED,
    );
  });

  it("keeps a guest's table unified under a split request", () => {
    expect(resolveChunkView(DiffViews.SPLIT, twoSided, true)).toBe(
      DiffViews.UNIFIED,
    );
  });

  it("stays unified when the reader asked for unified", () => {
    expect(resolveChunkView(DiffViews.UNIFIED, twoSided, false)).toBe(
      DiffViews.UNIFIED,
    );
  });
});

describe("resolveChunkGithubUrl", () => {
  const head = { repoSlug: "acme/widgets", sha: "head1234" };
  const fileUrl = "https://github.com/acme/widgets/blob/head1234/src/a.ts";
  const modifiedLoc = { added: 1, deleted: 1 };
  const deletionLoc = { added: 0, deleted: 2 };

  it("links a modified file once its hunk header landed", () => {
    const diff = [{ kind: "hunk" as const, content: "@@ -1,2 +1,3 @@" }];

    expect(
      resolveChunkGithubUrl({ file: "src/a.ts", diff, loc: deletionLoc }, head),
    ).toBe(fileUrl);
  });

  it("links a file with added lines before its diff rows land", () => {
    const rowless = resolveChunkGithubUrl(
      { file: "src/a.ts", loc: modifiedLoc },
      head,
    );
    const headerless = resolveChunkGithubUrl(
      {
        file: "src/a.ts",
        diff: [{ kind: "add", content: "a", newLine: 1 }],
        loc: modifiedLoc,
      },
      head,
    );

    expect(rowless).toBe(fileUrl);
    expect(headerless).toBe(fileUrl);
  });

  it("links nothing for a deleted file", () => {
    const diff = [{ kind: "hunk" as const, content: "@@ -1,2 +0,0 @@" }];

    expect(
      resolveChunkGithubUrl({ file: "src/a.ts", diff, loc: deletionLoc }, head),
    ).toBe(undefined);
  });

  it("links nothing for a deletion while the file's status is unknown", () => {
    const rowless = resolveChunkGithubUrl(
      { file: "src/a.ts", loc: deletionLoc },
      head,
    );
    const headerless = resolveChunkGithubUrl(
      {
        file: "src/a.ts",
        diff: [{ kind: "del", content: "a", oldLine: 1 }],
        loc: deletionLoc,
      },
      head,
    );

    expect(rowless).toBe(undefined);
    expect(headerless).toBe(undefined);
  });

  it("encodes each path segment and keeps the slashes", () => {
    const url = resolveChunkGithubUrl(
      { file: "docs/a b/#notes.md", loc: modifiedLoc },
      head,
    );

    expect(url).toBe(
      "https://github.com/acme/widgets/blob/head1234/docs/a%20b/%23notes.md",
    );
  });

  it("links nothing without a head", () => {
    expect(
      resolveChunkGithubUrl({ file: "src/a.ts", loc: modifiedLoc }, undefined),
    ).toBe(undefined);
  });
});
