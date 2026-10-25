import type { ReviewDraftCommentRow } from "persistence";
import { CommentAnchorKinds, DiffSides } from "types/comments";
import { describe, expect, it } from "vitest";
import { makeDraftCommentRow } from "../../../../../../test/fixtures";
import { shapePublishComment } from "./anchor";
import { foldCommentsIntoBody } from "./fold";

function makeFileDraft(
  patch: Partial<ReviewDraftCommentRow> = {},
): ReviewDraftCommentRow {
  return makeDraftCommentRow({
    anchor: { kind: CommentAnchorKinds.FILE, file: "src/app.ts" },
    body: "on the file",
    ...patch,
  });
}

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
      [shapePublishComment(makeFileDraft())],
      3,
    );
    expect(folded).toContain(
      "1 of 3 comments could not be anchored to the diff and were folded into this review body:",
    );
    expect(folded?.startsWith("overall verdict")).toBe(true);
  });

  it("reads a full fold of one comment as that comment", () => {
    const comments = [shapePublishComment(makeFileDraft())];
    const folded = foldCommentsIntoBody("overall verdict", comments, 1);
    expect(folded).toContain(
      "This comment could not be anchored to the diff, so it is included here:",
    );
    expect(folded).not.toContain("1 of 1");
  });

  it("reads a full fold of several comments as the set, never N of N", () => {
    const comments = [
      shapePublishComment(makeFileDraft()),
      shapePublishComment(makeDraftCommentRow()),
    ];
    const folded = foldCommentsIntoBody(undefined, comments, 2);
    expect(folded).toContain(
      "These 2 comments could not be anchored to the diff, so they are included here:",
    );
    expect(folded).not.toContain("2 of 2");
  });

  it("folds a File comment as path with no range", () => {
    const folded = foldCommentsIntoBody(
      "overall verdict",
      [shapePublishComment(makeFileDraft())],
      1,
    );
    expect(folded).toContain("**`src/app.ts`**");
    expect(folded).not.toContain("src/app.ts:");
    expect(folded).toContain("on the file");
  });

  it("folds without a body when the review has none", () => {
    const folded = foldCommentsIntoBody(
      undefined,
      [shapePublishComment(makeDraftCommentRow())],
      1,
    );
    expect(folded?.startsWith("---")).toBe(true);
    expect(folded).toContain("**`src/a.ts:12`**");
  });

  it("folds the fixture the web submit mirror pins to the same length", () => {
    // The web submit check holds a literal copy of this fixture and length:
    // apps/web/src/features/review/utils/submit.test.ts. Change both or neither.
    const drafts = [
      makeFileDraft({ body: "on the file 🧪" }),
      makeDraftCommentRow(),
      makeDraftCommentRow({
        anchor: {
          kind: CommentAnchorKinds.LINE,
          file: "src/b.ts",
          side: DiffSides.OLD,
          startLine: 25,
          endLine: 30,
        },
        body: "range note",
      }),
      makeDraftCommentRow({
        anchor: {
          kind: CommentAnchorKinds.LINE,
          file: "src/c.ts",
          side: DiffSides.NEW,
          startSide: DiffSides.OLD,
          startLine: 10,
          endLine: 10,
        },
        body: "crossing note 𝔸",
      }),
    ].map(shapePublishComment);

    const folded = foldCommentsIntoBody(
      "Looks right 🚀\n\n---\n\nsignature line",
      drafts,
      drafts.length,
    );

    expect(folded?.length).toBe(273);
  });

  it("folds the fixture the web pins with its unplaced drafts", () => {
    // The web submit check holds a literal copy of this fixture and length,
    // split into drafts it renders and drafts it holds unplaced:
    // apps/web/src/features/review/utils/submit.test.ts. Change both or neither.
    const drafts = [
      makeFileDraft({ body: "on the file 🧪" }),
      makeDraftCommentRow(),
      makeFileDraft({
        anchor: { kind: CommentAnchorKinds.FILE, file: "src/gone.ts" },
        body: "gone file 🧹",
      }),
      makeDraftCommentRow({
        anchor: {
          kind: CommentAnchorKinds.LINE,
          file: "src/gone.ts",
          side: DiffSides.OLD,
          startLine: 4,
          endLine: 6,
        },
        body: "gone range",
      }),
      makeDraftCommentRow({
        anchor: {
          kind: CommentAnchorKinds.LINE,
          file: "src/gone.ts",
          side: DiffSides.NEW,
          startSide: DiffSides.OLD,
          startLine: 8,
          endLine: 9,
        },
        body: "gone crossing",
      }),
    ].map(shapePublishComment);

    const folded = foldCommentsIntoBody(
      "Looks right 🚀\n\n---\n\nsignature line",
      drafts,
      drafts.length,
    );

    expect(folded?.length).toBe(305);
  });
});
