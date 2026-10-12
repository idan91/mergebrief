import { describe, expect, it } from "vitest";
import type { Equals } from "types/utils";
import type { z } from "zod/v4";

import {
  parseAddressedReviewComment,
  parseAddressedReviewComments,
  parseComparisonMarks,
  type addressedReviewCommentSchema,
  type comparisonMarksSchema,
  type revisionChangeFileSchema,
} from "./schemas";
import type {
  AddressedReviewComment,
  ComparisonMarks,
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
} as const;

describe("brief model schemas match their interfaces", () => {
  it.each(Object.entries(SCHEMA_PINS))("%s is pinned", (_shape, pinned) => {
    expect(pinned).toBe(true);
  });
});
