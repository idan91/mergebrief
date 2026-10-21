import type {
  LocalBriefSummary,
  LocalComparisonAvailability,
  LocalLastReviewAvailability,
  LocalPreviousBriefAvailability,
} from "contract";
import { describe, expect, it } from "vitest";
import type { Equals } from "types/utils";
import type { z } from "zod/v4";

import { parseWithSchema } from "@web/utils/parse-with-schema";
import {
  addressedReviewCommentSchema,
  briefContextSchema,
  localBriefSummariesSchema,
  parseAddressedReviewComments,
  parseComparisonMarks,
  type comparisonMarksSchema,
  type deEmphasisRuleSchema,
  type firedCustomAttributeSchema,
  type repoConfigContextSchema,
  type repoConfigFileOutcomeSchema,
  type fileDiffPatchSchema,
  type localBriefSummarySchema,
  type localComparisonAvailabilitySchema,
  type localLastReviewAvailabilitySchema,
  type localPreviousBriefAvailabilitySchema,
  type revisionChangeFileSchema,
} from "./schemas";
import {
  briefFixture,
  repoConfigContextFixture as SNAPSHOT,
} from "../test-utils/fixtures";
import type {
  DeEmphasisRule,
  FiredCustomAttribute,
  RepoConfigContext,
  RepoConfigFileOutcome,
} from "./utils/repo-config";
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

describe("addressedReviewCommentSchema", () => {
  it("reads every field of a stored review comment", () => {
    const { inReplyToId: _reply, ...present } = REVIEW_COMMENT;

    expect(
      parseWithSchema(addressedReviewCommentSchema, REVIEW_COMMENT),
    ).toStrictEqual({
      ok: true,
      value: present,
    });
  });

  it("reads null or absent lines as absent and derives outdated from line", () => {
    const parsed = parseWithSchema(addressedReviewCommentSchema, {
      id: "c2",
      file: "src/a.ts",
      line: null,
      author: "bob",
      body: "gone",
      inReplyToId: "c1",
    });

    expect(parsed).toStrictEqual({
      ok: true,
      value: {
        id: "c2",
        file: "src/a.ts",
        author: "bob",
        body: "gone",
        inReplyToId: "c1",
        outdated: true,
      },
    });
  });

  it("derives outdated from the line when the wire sends null", () => {
    const parsed = parseWithSchema(addressedReviewCommentSchema, {
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
    const parsed = parseWithSchema(
      addressedReviewCommentSchema,
      withoutOutdated,
    );

    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.outdated).toBe(false);
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

  it("reads a null or absent baselineIndex as absent", () => {
    const { baselineIndex: _index, ...withoutIndex } = MARKS;

    expect(parseComparisonMarks(withoutIndex)).toStrictEqual({
      ok: true,
      value: withoutIndex,
    });
    expect(
      parseComparisonMarks({ ...MARKS, baselineIndex: null }),
    ).toStrictEqual({ ok: true, value: withoutIndex });
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

describe("localBriefSummariesSchema", () => {
  it("round-trips a brief row with both comparison baselines", () => {
    expect(parseWithSchema(localBriefSummariesSchema, [briefRow])).toEqual({
      ok: true,
      value: [briefRow],
    });
  });

  it("round-trips a delta row with its revision fields", () => {
    expect(parseWithSchema(localBriefSummariesSchema, [deltaRow])).toEqual({
      ok: true,
      value: [deltaRow],
    });
  });

  it("keeps null delta indexes", () => {
    const row = { ...deltaRow, baselineIndex: null, headIndex: null };

    expect(parseWithSchema(localBriefSummariesSchema, [row])).toEqual({
      ok: true,
      value: [row],
    });
  });

  it("keeps a last review with marks but no delta yet", () => {
    const row = makeBriefRowWithComparison("lastReview", {
      marksId: "marks-last",
      baselineSha: "c".repeat(40),
      baselineIndex: 3,
    });

    expect(parseWithSchema(localBriefSummariesSchema, [row])).toEqual({
      ok: true,
      value: [row],
    });
  });

  it("keeps a previous brief without a narrative", () => {
    const row = makeBriefRowWithComparison(
      "previousBrief",
      omitField(previousBriefAvailability, "narrativeId"),
    );

    expect(parseWithSchema(localBriefSummariesSchema, [row])).toEqual({
      ok: true,
      value: [row],
    });
  });

  it("keeps a brief row without comparisons", () => {
    const row = omitField(briefRow, "comparisons");

    expect(parseWithSchema(localBriefSummariesSchema, [row])).toEqual({
      ok: true,
      value: [row],
    });
  });

  it("refuses a row with a fractional number", () => {
    const row = { ...briefRow, number: 4.5 };

    expect(parseWithSchema(localBriefSummariesSchema, [row]).ok).toBe(false);
  });

  it("refuses a listing that is not an array", () => {
    expect(
      parseWithSchema(localBriefSummariesSchema, { rows: [briefRow] }).ok,
    ).toBe(false);
  });
});

describe("briefContextSchema", () => {
  it("parses a full envelope round-trip", () => {
    const parsed = parseWithSchema(briefContextSchema, {
      repoConfig: SNAPSHOT,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value).toEqual(SNAPSHOT);
  });

  it("null snapshot parses to null", () => {
    const parsed = parseWithSchema(briefContextSchema, { repoConfig: null });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value).toBeNull();
  });
});

describe("briefContextSchema canonical-shape tightening", () => {
  const slots = SNAPSHOT.files;
  it.each([
    ["missing a slot", { ...SNAPSHOT, files: slots.slice(0, 2) }],
    ["reordered slots", { ...SNAPSHOT, files: [slots[1], slots[0], slots[2]] }],
    [
      "foreign path",
      {
        ...SNAPSHOT,
        files: [slots[0], slots[1], { ...slots[2], path: "evil.yaml" }],
      },
    ],
    [
      "off-charset fired name",
      {
        ...SNAPSHOT,
        policy: {
          firedCustomAttributes: [{ name: "Bad Name", criteria: "c" }],
          deEmphasize: [],
        },
      },
    ],
    [
      "over-cap criteria",
      {
        ...SNAPSHOT,
        policy: {
          firedCustomAttributes: [
            { name: "ok-name", criteria: "x".repeat(4001) },
          ],
          deEmphasize: [],
        },
      },
    ],
    [
      "floor attribute in deEmphasize",
      {
        ...SNAPSHOT,
        policy: {
          firedCustomAttributes: [],
          deEmphasize: [{ attribute: "touches-auth" }],
        },
      },
    ],
  ])("rejects a snapshot with %s", (_label, snapshot) => {
    expect(
      parseWithSchema(briefContextSchema, { repoConfig: snapshot }).ok,
    ).toBe(false);
  });
});

function readSlot(index: number): RepoConfigFileOutcome {
  const slot = SNAPSHOT.files[index];
  if (slot === undefined) {
    throw new Error("fixture");
  }
  return slot;
}

describe("briefContextSchema tolerances", () => {
  const instructions = readSlot(0);
  const settings = readSlot(1);
  const policyFile = readSlot(2);

  it("keeps optional outcome fields and accepts an empty rule path", () => {
    const snapshot = {
      ...SNAPSHOT,
      files: [
        { ...instructions, detail: "d", warning: "w", bytesUsed: 1 },
        settings,
        { ...policyFile, bytesBudget: 4 },
      ],
      policy: {
        firedCustomAttributes: [],
        deEmphasize: [{ attribute: "no-tests", paths: [""] }],
      },
    };

    expect(
      parseWithSchema(briefContextSchema, { repoConfig: snapshot }),
    ).toEqual({
      ok: true,
      value: snapshot,
    });
  });

  it.each([
    ["an empty fired path", { paths: [""] }],
    ["an empty implication", { implication: "" }],
  ])("rejects a fired attribute with %s", (_label, extra) => {
    const policy = {
      firedCustomAttributes: [{ name: "ok-name", criteria: "c", ...extra }],
      deEmphasize: [],
    };

    expect(
      parseWithSchema(briefContextSchema, {
        repoConfig: { ...SNAPSHOT, policy },
      }).ok,
    ).toBe(false);
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
  RepoConfigFileOutcome: true satisfies Equals<
    z.output<typeof repoConfigFileOutcomeSchema>,
    RepoConfigFileOutcome
  >,
  FiredCustomAttribute: true satisfies Equals<
    z.output<typeof firedCustomAttributeSchema>,
    FiredCustomAttribute
  >,
  DeEmphasisRule: true satisfies Equals<
    z.output<typeof deEmphasisRuleSchema>,
    DeEmphasisRule
  >,
  RepoConfigContext: true satisfies Equals<
    z.output<typeof repoConfigContextSchema>,
    RepoConfigContext
  >,
} as const;

void SCHEMA_PINS;
