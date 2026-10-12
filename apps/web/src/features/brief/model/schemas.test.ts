import type {
  LocalBriefSummary,
  LocalComparisonAvailability,
  LocalLastReviewAvailability,
  LocalPreviousBriefAvailability,
} from "contract";
import { describe, expect, it } from "vitest";
import type { Equals } from "types/utils";
import type { z } from "zod/v4";

import {
  parseAddressedReviewComment,
  parseAddressedReviewComments,
  parseComparisonMarks,
  parseFileDiffPatches,
  parseLocalBriefSummaries,
  type addressedReviewCommentSchema,
  type comparisonMarksSchema,
  type fileDiffPatchSchema,
  type localBriefSummarySchema,
  type localComparisonAvailabilitySchema,
  type localLastReviewAvailabilitySchema,
  type localPreviousBriefAvailabilitySchema,
  type revisionChangeFileSchema,
} from "./schemas";
import { briefFixture } from "../test-utils/fixtures";
import type {
  AddressedReviewComment,
  ComparisonMarks,
  FileDiffPatch,
  RevisionChangeFile,
} from "./types";

const REVIEW_COMMENT = {
  id: "c1",
  file: "src/a.ts",
  startLine: 10,
  line: 12,
  originalStartLine: 9,
  originalLine: 11,
  author: "alice",
  body: "tighten this",
  inReplyToId: null,
  outdated: false,
};

describe("parseAddressedReviewComment", () => {
  it("reads every field of a stored review comment", () => {
    expect(parseAddressedReviewComment(REVIEW_COMMENT)).toEqual({
      ok: true,
      value: REVIEW_COMMENT,
    });
  });

  it("reads absent optional lines as null and derives outdated from line", () => {
    const parsed = parseAddressedReviewComment({
      id: "c2",
      file: "src/a.ts",
      line: null,
      author: "bob",
      body: "gone",
      inReplyToId: "c1",
    });

    expect(parsed).toEqual({
      ok: true,
      value: {
        id: "c2",
        file: "src/a.ts",
        startLine: null,
        line: null,
        originalStartLine: null,
        originalLine: null,
        author: "bob",
        body: "gone",
        inReplyToId: "c1",
        outdated: true,
      },
    });
  });

  it("derives outdated from the line when the wire sends null", () => {
    const parsed = parseAddressedReviewComment({
      ...REVIEW_COMMENT,
      outdated: null,
    });

    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.outdated).toBe(false);
  });

  it("reads an anchored comment without outdated as current", () => {
    const { outdated: _outdated, ...withoutOutdated } = REVIEW_COMMENT;
    const parsed = parseAddressedReviewComment(withoutOutdated);

    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.outdated).toBe(false);
  });

  it("refuses a comment missing its line, reply link or id", () => {
    const { line: _line, ...withoutLine } = REVIEW_COMMENT;
    const { inReplyToId: _reply, ...withoutReply } = REVIEW_COMMENT;

    expect(parseAddressedReviewComment(withoutLine).ok).toBe(false);
    expect(parseAddressedReviewComment(withoutReply).ok).toBe(false);
    expect(parseAddressedReviewComment({ ...REVIEW_COMMENT, id: 1 }).ok).toBe(
      false,
    );
  });

  it("refuses a list that is not an array", () => {
    expect(parseAddressedReviewComments({}).ok).toBe(false);
    expect(parseAddressedReviewComments([REVIEW_COMMENT]).ok).toBe(true);
  });
});

const MARKS = {
  baselineSha: "base-1",
  headSha: "head-2",
  baselineLabel: "checkpoint",
  baselineIndex: 1,
  files: [
    {
      file: "src/a.ts",
      addedRanges: [{ start: 3, end: 5 }],
      removedRanges: [],
    },
  ],
};

describe("parseComparisonMarks", () => {
  it("reads the header and per-file ranges", () => {
    expect(parseComparisonMarks(MARKS)).toEqual({ ok: true, value: MARKS });
  });

  it("reads an absent baselineIndex as null", () => {
    const { baselineIndex: _index, ...withoutIndex } = MARKS;

    expect(parseComparisonMarks(withoutIndex)).toEqual({
      ok: true,
      value: { ...withoutIndex, baselineIndex: null },
    });
  });

  it("refuses an unknown baseline label, a fractional range or no files", () => {
    const fractional = {
      ...MARKS,
      files: [
        { file: "a", addedRanges: [{ start: 1.5, end: 2 }], removedRanges: [] },
      ],
    };
    const { files: _files, ...withoutFiles } = MARKS;

    expect(parseComparisonMarks({ ...MARKS, baselineLabel: "x" }).ok).toBe(
      false,
    );
    expect(parseComparisonMarks(fractional).ok).toBe(false);
    expect(parseComparisonMarks(withoutFiles).ok).toBe(false);
  });
});

describe("parseFileDiffPatches", () => {
  it("reads per-file patches", () => {
    const diffs = [{ file: "src/a.ts", patch: "@@ -1 +1 @@\n-a\n+b" }];

    expect(parseFileDiffPatches(diffs)).toEqual({ ok: true, value: diffs });
  });

  it("refuses a non-array listing or an entry without a patch", () => {
    expect(parseFileDiffPatches({}).ok).toBe(false);
    expect(parseFileDiffPatches([{ file: "src/a.ts" }]).ok).toBe(false);
  });
});

const { pr } = briefFixture;

const previousBriefAvailability = {
  marksId: "marks-prev",
  narrativeId: "narrative-prev",
  baselineSha: "a".repeat(40),
  baselineIndex: 1,
};

const lastReviewAvailability = {
  marksId: "marks-last",
  deltaId: "delta-last",
  baselineSha: "c".repeat(40),
  baselineIndex: null,
};

const briefRow = {
  id: "components-4_2_a01bcf1d",
  artifactKind: "brief",
  repo: pr.repo,
  number: pr.number,
  title: pr.title,
  sha: pr.sha,
  index: 2,
  comparisons: {
    previousBrief: previousBriefAvailability,
    lastReview: lastReviewAvailability,
  },
};

const deltaRow = {
  id: "components-4_delta_a01bcf1d",
  artifactKind: "delta",
  repo: pr.repo,
  number: pr.number,
  title: pr.title,
  sha: pr.sha,
  baselineSha: "c".repeat(40),
  headSha: pr.sha,
  baselineIndex: 1,
  headIndex: 2,
};

function omitField(
  record: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const copy = { ...record };
  delete copy[field];
  return copy;
}

function makeBriefRowWithComparison(
  key: "previousBrief" | "lastReview",
  availability: unknown,
): Record<string, unknown> {
  return {
    ...briefRow,
    comparisons: { ...briefRow.comparisons, [key]: availability },
  };
}

describe("parseLocalBriefSummaries", () => {
  it("round-trips a brief row with both comparison baselines", () => {
    expect(parseLocalBriefSummaries([briefRow])).toEqual({
      ok: true,
      value: [briefRow],
    });
  });

  it("round-trips a delta row with its revision fields", () => {
    expect(parseLocalBriefSummaries([deltaRow])).toEqual({
      ok: true,
      value: [deltaRow],
    });
  });

  it("keeps null delta indexes", () => {
    const row = { ...deltaRow, baselineIndex: null, headIndex: null };

    expect(parseLocalBriefSummaries([row])).toEqual({ ok: true, value: [row] });
  });

  it("keeps a last review with marks but no delta yet", () => {
    const row = makeBriefRowWithComparison("lastReview", {
      marksId: "marks-last",
      baselineSha: "c".repeat(40),
      baselineIndex: 3,
    });

    expect(parseLocalBriefSummaries([row])).toEqual({ ok: true, value: [row] });
  });

  it("keeps a previous brief without a narrative", () => {
    const row = makeBriefRowWithComparison(
      "previousBrief",
      omitField(previousBriefAvailability, "narrativeId"),
    );

    expect(parseLocalBriefSummaries([row])).toEqual({ ok: true, value: [row] });
  });

  it("keeps a brief row without comparisons", () => {
    const row = omitField(briefRow, "comparisons");

    expect(parseLocalBriefSummaries([row])).toEqual({ ok: true, value: [row] });
  });

  it.each(["id", "artifactKind", "repo", "number", "title", "sha"])(
    "refuses a row without its %s",
    (field) => {
      expect(parseLocalBriefSummaries([omitField(briefRow, field)]).ok).toBe(
        false,
      );
    },
  );

  it.each(["marksId", "baselineSha", "baselineIndex"])(
    "refuses a previous brief without its %s",
    (field) => {
      const row = makeBriefRowWithComparison(
        "previousBrief",
        omitField(previousBriefAvailability, field),
      );

      expect(parseLocalBriefSummaries([row]).ok).toBe(false);
    },
  );

  it.each(["marksId", "baselineSha", "baselineIndex"])(
    "refuses a last review without its %s",
    (field) => {
      const row = makeBriefRowWithComparison(
        "lastReview",
        omitField(lastReviewAvailability, field),
      );

      expect(parseLocalBriefSummaries([row]).ok).toBe(false);
    },
  );

  it.each([
    ["an unknown artifactKind", { ...briefRow, artifactKind: "draft" }],
    ["a fractional number", { ...briefRow, number: 4.5 }],
    ["a string index", { ...briefRow, index: "2" }],
    ["a null index", { ...briefRow, index: null }],
    ["a numeric baselineSha", { ...deltaRow, baselineSha: 1 }],
    ["a numeric headSha", { ...deltaRow, headSha: 1 }],
    ["a string headIndex", { ...deltaRow, headIndex: "2" }],
    ["non-object comparisons", { ...briefRow, comparisons: "none" }],
    [
      "a null narrative id",
      makeBriefRowWithComparison("previousBrief", {
        ...previousBriefAvailability,
        narrativeId: null,
      }),
    ],
    [
      "a null delta id",
      makeBriefRowWithComparison("lastReview", {
        ...lastReviewAvailability,
        deltaId: null,
      }),
    ],
    [
      "a null previous-brief baselineIndex",
      makeBriefRowWithComparison("previousBrief", {
        ...previousBriefAvailability,
        baselineIndex: null,
      }),
    ],
    [
      "a numeric narrativeId",
      makeBriefRowWithComparison("previousBrief", {
        ...previousBriefAvailability,
        narrativeId: 3,
      }),
    ],
    [
      "a numeric deltaId",
      makeBriefRowWithComparison("lastReview", {
        ...lastReviewAvailability,
        deltaId: 3,
      }),
    ],
  ])("refuses a row with %s", (_case, row) => {
    expect(parseLocalBriefSummaries([row]).ok).toBe(false);
  });

  it("refuses a listing that is not an array", () => {
    expect(parseLocalBriefSummaries({ rows: [briefRow] }).ok).toBe(false);
  });
});

const SCHEMA_PINS = {
  AddressedReviewComment: true satisfies Equals<
    z.output<typeof addressedReviewCommentSchema>,
    AddressedReviewComment
  >,
  RevisionChangeFile: true satisfies Equals<
    z.output<typeof revisionChangeFileSchema>,
    RevisionChangeFile
  >,
  ComparisonMarks: true satisfies Equals<
    z.output<typeof comparisonMarksSchema>,
    ComparisonMarks
  >,
  FileDiffPatch: true satisfies Equals<
    z.output<typeof fileDiffPatchSchema>,
    FileDiffPatch
  >,
  LocalPreviousBriefAvailability: true satisfies Equals<
    z.output<typeof localPreviousBriefAvailabilitySchema>,
    LocalPreviousBriefAvailability
  >,
  LocalLastReviewAvailability: true satisfies Equals<
    z.output<typeof localLastReviewAvailabilitySchema>,
    LocalLastReviewAvailability
  >,
  LocalComparisonAvailability: true satisfies Equals<
    z.output<typeof localComparisonAvailabilitySchema>,
    LocalComparisonAvailability
  >,
  LocalBriefSummary: true satisfies Equals<
    z.output<typeof localBriefSummarySchema>,
    LocalBriefSummary
  >,
} as const;

describe("brief model schemas match their interfaces", () => {
  it.each(Object.entries(SCHEMA_PINS))("%s is pinned", (_shape, pinned) => {
    expect(pinned).toBe(true);
  });
});
