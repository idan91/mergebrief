import { ReviewCommentSides, ReviewSubjectTypes } from "github";
import {
  DraftCommentSides,
  DraftCommentStatuses,
  type ReviewDraftCommentRow,
} from "persistence";
import { CommentAnchorKinds } from "types/comments";
import { describe, expect, it } from "vitest";
import { readDraftAnchor, shapeInlineCommentWrite } from "./draft-anchor";

const STAMP = new Date("2026-01-01T00:00:00Z");

function makeLineDraft(
  patch: Partial<ReviewDraftCommentRow> = {},
): ReviewDraftCommentRow {
  return {
    id: 1n,
    installationId: 1n,
    reviewSessionId: 10n,
    anchor: {
      kind: CommentAnchorKinds.LINE,
      file: "src/index.ts",
      side: DraftCommentSides.NEW,
      startLine: 10,
      endLine: 12,
    },
    body: "post now",
    status: DraftCommentStatuses.DRAFT,
    anchorStatus: null,
    carriedFromSessionId: null,
    carriedFromCommentId: null,
    createdAt: STAMP,
    ...patch,
  } as ReviewDraftCommentRow;
}

describe("readDraftAnchor", () => {
  it("omits line and side on a File comment", () => {
    const anchor = readDraftAnchor(
      makeLineDraft({
        anchor: { kind: CommentAnchorKinds.FILE, file: "src/app.ts" },
      }),
    );
    expect(anchor).toEqual({
      path: "src/app.ts",
      subjectType: ReviewSubjectTypes.FILE,
    });
    expect("line" in anchor).toBe(false);
    expect("side" in anchor).toBe(false);
  });

  it("maps a multi-line draft onto GitHub line coordinates", () => {
    expect(readDraftAnchor(makeLineDraft())).toEqual({
      path: "src/index.ts",
      line: 12,
      side: ReviewCommentSides.RIGHT,
      startLine: 10,
      startSide: ReviewCommentSides.RIGHT,
    });
  });
});

describe("shapeInlineCommentWrite", () => {
  const pin = {
    owner: "o",
    repo: "r",
    prNumber: 7,
    commitId: "a".repeat(40),
  };

  it("pins a File comment with subjectType file and no line", () => {
    expect(
      shapeInlineCommentWrite(
        makeLineDraft({
          anchor: { kind: CommentAnchorKinds.FILE, file: "src/app.ts" },
        }),
        pin,
      ),
    ).toEqual({
      ...pin,
      path: "src/app.ts",
      body: "post now",
      subjectType: ReviewSubjectTypes.FILE,
    });
  });
});
