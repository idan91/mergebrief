import { DraftCommentSides } from "persistence";
import { CommentAnchorKinds } from "types/comments";
import { describe, expect, it } from "vitest";
import { anchorSchema, createDraftSchema } from "./schemas";

describe("anchorSchema file arm", () => {
  const fileAnchor = {
    kind: CommentAnchorKinds.FILE,
    filePath: "src/app.ts",
  };

  it("accepts a path with no line columns", () => {
    expect(anchorSchema.parse(fileAnchor)).toEqual(fileAnchor);
  });

  it.each([
    ["a start line", { startLine: 1 }],
    ["an end line", { endLine: 1 }],
    ["a side", { side: DraftCommentSides.NEW }],
    ["a start side", { startSide: DraftCommentSides.OLD }],
  ])("rejects mixing the file kind with %s", (_case, extra) => {
    expect(anchorSchema.safeParse({ ...fileAnchor, ...extra }).success).toBe(
      false,
    );
  });
});

describe("createDraftSchema file arm", () => {
  it("accepts a File comment body with no span", () => {
    expect(
      createDraftSchema.parse({
        kind: CommentAnchorKinds.FILE,
        filePath: "src/app.ts",
        body: "on the file",
      }),
    ).toEqual({
      kind: CommentAnchorKinds.FILE,
      filePath: "src/app.ts",
      body: "on the file",
    });
  });

  it("rejects mixing the file kind with a partial span", () => {
    expect(
      createDraftSchema.safeParse({
        kind: CommentAnchorKinds.FILE,
        filePath: "src/app.ts",
        startLine: 10,
        body: "on the file",
      }).success,
    ).toBe(false);
  });
});
