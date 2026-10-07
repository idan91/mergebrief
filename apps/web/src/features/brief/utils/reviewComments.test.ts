import type { DiffLine } from "@web/utils/diffTokens/types";
import { describe, expect, it } from "vitest";

import {
  pathOnlyFileCommentsForChunk,
  reviewCommentMatchesDiffLine,
  reviewCommentsForChunk,
} from "./reviewComments";
import type { AddressedReviewComment, BriefChunk } from "../types";

const chunk = {
  id: "c1",
  changeGroupId: "g1",
  file: "src/components/Accordion/Accordion.tsx",
  concern: "implementation",
  role: "core",
  loc: { added: 1, deleted: 1 },
  addedRanges: [{ start: 103, end: 103 }],
  removedRanges: [{ start: 101, end: 101 }],
  riskSurface: [],
} satisfies BriefChunk;

const comment = {
  id: "3419186366",
  file: "src/components/Accordion/Accordion.tsx",
  startLine: null,
  line: 103,
  originalStartLine: null,
  originalLine: 101,
  author: "Idan91",
  body: "Let's make the open-close state typesafe.",
  inReplyToId: null,
  outdated: false,
} satisfies AddressedReviewComment;

describe("reviewCommentsForChunk", () => {
  it("falls back to same-file comments without addressed ids", () => {
    const otherFileComment = {
      ...comment,
      id: "other",
      file: "src/other.ts",
    } satisfies AddressedReviewComment;

    expect(
      reviewCommentsForChunk([comment, otherFileComment], chunk).map(
        (item) => item.id,
      ),
    ).toEqual(["3419186366"]);
  });

  it("associates outdated comments with new-file chunks", () => {
    const outdated = {
      ...comment,
      line: null,
      originalLine: 103,
      outdated: true,
    } satisfies AddressedReviewComment;
    const newFileChunk = {
      ...chunk,
      addedRanges: [{ start: 1, end: 175 }],
      removedRanges: [],
      diff: [{ kind: "add", newLine: 103, content: "return (" }],
    } satisfies BriefChunk;

    expect(
      reviewCommentsForChunk([outdated], newFileChunk).map((item) => item.id),
    ).toEqual(["3419186366"]);
    const row = newFileChunk.diff[0];
    expect(row).toBeDefined();
    if (!row) {
      return;
    }
    expect(
      reviewCommentMatchesDiffLine(
        outdated,
        newFileChunk.file,
        row,
        newFileChunk.diff,
      ),
    ).toBe(false);
  });

  it("uses addressed comment ids when the chunk links comments explicitly", () => {
    const linkedChunk = {
      ...chunk,
      addressesComments: ["reply"],
    } satisfies BriefChunk;
    const reply = {
      ...comment,
      id: "reply",
      inReplyToId: "3419186366",
    } satisfies AddressedReviewComment;

    expect(
      reviewCommentsForChunk([comment, reply], linkedChunk).map(
        (item) => item.id,
      ),
    ).toEqual(["reply"]);
  });
});

describe("reviewCommentMatchesDiffLine", () => {
  it("matches current comments on the new-side line", () => {
    const addLine = {
      kind: "add",
      newLine: 103,
      content: "data-state={state}",
    } satisfies DiffLine;

    expect(reviewCommentMatchesDiffLine(comment, chunk.file, addLine)).toBe(
      true,
    );
  });

  it("matches outdated comments on the old-side original line", () => {
    const outdated = {
      ...comment,
      line: null,
      originalLine: 101,
      outdated: true,
    } satisfies AddressedReviewComment;
    const delLine = {
      kind: "del",
      oldLine: 101,
      content: "data-state={open ? 'open' : 'closed'}",
    } satisfies DiffLine;

    expect(
      reviewCommentMatchesDiffLine(outdated, chunk.file, delLine, [delLine]),
    ).toBe(true);
  });

  it("does not match outdated comments on added lines", () => {
    const outdated = {
      ...comment,
      line: null,
      originalLine: 103,
      outdated: true,
    } satisfies AddressedReviewComment;
    const addLine = {
      kind: "add",
      newLine: 103,
      content: "data-state={state}",
    } satisfies DiffLine;

    expect(
      reviewCommentMatchesDiffLine(outdated, chunk.file, addLine, [addLine]),
    ).toBe(false);
  });
});

describe("file-level GitHub comments", () => {
  it("does not attach a path-only comment to the chunk diff", () => {
    const fileComment = {
      ...comment,
      id: "file-1",
      line: null,
      originalLine: null,
      startLine: null,
      originalStartLine: null,
    } satisfies AddressedReviewComment;

    expect(reviewCommentsForChunk([fileComment], chunk)).toEqual([]);
    expect(
      reviewCommentMatchesDiffLine(fileComment, chunk.file, {
        kind: "add",
        newLine: 103,
        content: "x",
      }),
    ).toBe(false);
  });

  it("selects path-only comments for the matching file", () => {
    const fileComment = {
      ...comment,
      id: "file-1",
      line: null,
      originalLine: null,
      startLine: null,
      originalStartLine: null,
    } satisfies AddressedReviewComment;
    const otherFile = {
      ...fileComment,
      id: "file-2",
      file: "src/other.ts",
    } satisfies AddressedReviewComment;

    expect(
      pathOnlyFileCommentsForChunk(
        [fileComment, otherFile, comment],
        chunk,
      ).map((item) => item.id),
    ).toEqual(["file-1"]);
  });
});
