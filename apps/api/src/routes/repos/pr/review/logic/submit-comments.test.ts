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
  toThreadInput,
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

describe("toThreadInput", () => {
  it("shapes a File comment as a FILE thread without line fields", () => {
    const thread = toThreadInput(
      "PRR_node",
      shapeSubmitComment(makeFileDraft()),
    );
    expect(thread).toEqual({
      reviewNodeId: "PRR_node",
      subjectType: ReviewSubjectTypes.FILE,
      path: "src/app.ts",
      body: "on the file",
    });
    expect("line" in thread).toBe(false);
    expect("side" in thread).toBe(false);
  });

  it("shapes a range draft as a LINE thread with the start pair", () => {
    const thread = toThreadInput(
      "PRR_node",
      shapeSubmitComment(
        makeLineDraft({
          anchor: {
            kind: CommentAnchorKinds.LINE,
            file: "src/b.ts",
            side: DraftCommentSides.OLD,
            startLine: 25,
            endLine: 30,
          },
        }),
      ),
    );
    expect(thread).toEqual({
      reviewNodeId: "PRR_node",
      subjectType: ReviewSubjectTypes.LINE,
      path: "src/b.ts",
      line: 30,
      side: ReviewCommentSides.LEFT,
      startLine: 25,
      startSide: ReviewCommentSides.LEFT,
      body: "anchored note",
    });
  });

  it("keeps a single-line draft free of the start pair", () => {
    const thread = toThreadInput(
      "PRR_node",
      shapeSubmitComment(makeLineDraft()),
    );
    expect("startLine" in thread).toBe(false);
    expect("startSide" in thread).toBe(false);
  });
});

describe("foldCommentsIntoBody", () => {
  it("returns the body untouched when nothing was rejected", () => {
    expect(foldCommentsIntoBody("overall verdict", [], 3)).toBe(
      "overall verdict",
    );
    expect(foldCommentsIntoBody(undefined, [], 3)).toBeUndefined();
  });

  it("names how many of the total were folded", () => {
    const folded = foldCommentsIntoBody(
      "overall verdict",
      [shapeSubmitComment(makeFileDraft())],
      3,
    );
    expect(folded).toContain(
      "1 of 3 comments could not be anchored to the diff and were folded into this review body (nothing was dropped):",
    );
    expect(folded?.startsWith("overall verdict")).toBe(true);
  });

  it("folds a File comment as path with no range", () => {
    const folded = foldCommentsIntoBody(
      "overall verdict",
      [shapeSubmitComment(makeFileDraft())],
      1,
    );
    expect(folded).toContain("**`src/app.ts`**");
    expect(folded).not.toContain("src/app.ts:");
    expect(folded).toContain("on the file");
  });

  it("folds without a body when the review has none", () => {
    const folded = foldCommentsIntoBody(
      undefined,
      [shapeSubmitComment(makeLineDraft())],
      1,
    );
    expect(folded?.startsWith("---")).toBe(true);
    expect(folded).toContain("**`src/a.ts:12`**");
  });
});
