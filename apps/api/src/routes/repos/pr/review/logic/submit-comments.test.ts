import { ReviewCommentSides, ReviewSubjectTypes } from "github";
import {
  DraftCommentSides,
  DraftCommentStatuses,
  type ReviewDraftCommentRow,
} from "persistence";
import { CommentAnchorKinds } from "types";
import { describe, expect, it } from "vitest";
import {
  foldCommentsIntoBody,
  shapeSubmitComment,
  toPrimitiveComments,
} from "./submit-comments";

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
      file: "src/a.ts",
      side: DraftCommentSides.NEW,
      startLine: 12,
      endLine: 12,
    },
    body: "anchored note",
    status: DraftCommentStatuses.DRAFT,
    anchorStatus: null,
    carriedFromSessionId: null,
    carriedFromCommentId: null,
    createdAt: STAMP,
    ...patch,
  } as ReviewDraftCommentRow;
}

function makeFileDraft(
  patch: Partial<ReviewDraftCommentRow> = {},
): ReviewDraftCommentRow {
  return makeLineDraft({
    anchor: { kind: CommentAnchorKinds.FILE, file: "src/app.ts" },
    body: "on the file",
    ...patch,
  });
}

describe("shapeSubmitComment", () => {
  it("omits line and side on a File comment", () => {
    expect(shapeSubmitComment(makeFileDraft())).toEqual({
      path: "src/app.ts",
      body: "on the file",
      subjectType: ReviewSubjectTypes.FILE,
    });
  });

  it("keeps a single-line draft on the line arm", () => {
    expect(shapeSubmitComment(makeLineDraft())).toEqual({
      path: "src/a.ts",
      line: 12,
      side: ReviewCommentSides.RIGHT,
      body: "anchored note",
    });
  });
});

describe("toPrimitiveComments", () => {
  it("sends subjectType file without line fields", () => {
    const [primitive] = toPrimitiveComments([
      shapeSubmitComment(makeFileDraft()),
    ]);
    expect(primitive).toEqual({
      path: "src/app.ts",
      body: "on the file",
      subjectType: ReviewSubjectTypes.FILE,
    });
    if (primitive === undefined) throw new Error("expected a primitive");
    expect("line" in primitive).toBe(false);
    expect("side" in primitive).toBe(false);
  });
});

describe("foldCommentsIntoBody", () => {
  it("folds a File comment as path with no range", () => {
    const folded = foldCommentsIntoBody("overall verdict", [
      shapeSubmitComment(makeFileDraft()),
    ]);
    expect(folded).toContain("**`src/app.ts`**");
    expect(folded).not.toContain("src/app.ts:");
    expect(folded).toContain("on the file");
  });
});
