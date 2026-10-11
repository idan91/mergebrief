import { ReviewCommentSides, ReviewSubjectTypes } from "github";
import { CommentAnchorKinds, DiffSides } from "types/comments";
import { describe, expect, it } from "vitest";
import { makeDraftCommentRow } from "../../../../../../test/fixtures";
import {
  readGitHubAnchor,
  shapeInlineCommentInput,
  shapePublishComment,
  shapeThreadInput,
} from "./anchor";

function makeFileDraft() {
  return makeDraftCommentRow({
    anchor: { kind: CommentAnchorKinds.FILE, file: "src/app.ts" },
    body: "on the file",
  });
}

function makeRangeDraft() {
  return makeDraftCommentRow({
    anchor: {
      kind: CommentAnchorKinds.LINE,
      file: "src/b.ts",
      side: DiffSides.OLD,
      startLine: 25,
      endLine: 30,
    },
  });
}

describe("readGitHubAnchor", () => {
  it("omits line and side on a File comment", () => {
    const anchor = readGitHubAnchor(makeFileDraft());
    expect(anchor).toEqual({
      path: "src/app.ts",
      subjectType: ReviewSubjectTypes.FILE,
    });
    expect("line" in anchor).toBe(false);
    expect("side" in anchor).toBe(false);
  });

  it("keeps a single-line draft free of the start pair", () => {
    expect(readGitHubAnchor(makeDraftCommentRow())).toEqual({
      path: "src/a.ts",
      line: 12,
      side: ReviewCommentSides.RIGHT,
    });
  });

  it("maps a multi-line draft onto GitHub line coordinates", () => {
    expect(readGitHubAnchor(makeRangeDraft())).toEqual({
      path: "src/b.ts",
      line: 30,
      side: ReviewCommentSides.LEFT,
      startLine: 25,
      startSide: ReviewCommentSides.LEFT,
    });
  });
});

describe("shapeInlineCommentInput", () => {
  const pin = { prNumber: 7, commitId: "a".repeat(40) };

  it("pins a File comment with subjectType file and no line", () => {
    expect(
      shapeInlineCommentInput(shapePublishComment(makeFileDraft()), pin),
    ).toEqual({
      ...pin,
      path: "src/app.ts",
      body: "on the file",
      subjectType: ReviewSubjectTypes.FILE,
    });
  });
});

describe("shapeThreadInput", () => {
  it("shapes a File comment as a FILE thread without line fields", () => {
    const thread = shapeThreadInput(
      "PRR_node",
      shapePublishComment(makeFileDraft()),
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
    expect(
      shapeThreadInput("PRR_node", shapePublishComment(makeRangeDraft())),
    ).toEqual({
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
    const thread = shapeThreadInput(
      "PRR_node",
      shapePublishComment(makeDraftCommentRow()),
    );
    expect("startLine" in thread).toBe(false);
    expect("startSide" in thread).toBe(false);
  });
});
