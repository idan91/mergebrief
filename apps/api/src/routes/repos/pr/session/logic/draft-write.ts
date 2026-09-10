// Parsed session writes as the store's union: a File comment has no line
// columns, and a Line comment always names kind so a reanchor can convert.
import type { DraftCommentPatch, DraftCommentWrite } from "persistence";
import { CommentAnchorKinds } from "types";
import type { z } from "zod";
import type { anchorSchema, createDraftSchema } from "../schemas";

type CreateDraftParsed = z.infer<typeof createDraftSchema>;
type AnchorParsed = z.infer<typeof anchorSchema>;

export function createDraftWrite(parsed: CreateDraftParsed): DraftCommentWrite {
  if (parsed.kind === CommentAnchorKinds.FILE) {
    return {
      kind: CommentAnchorKinds.FILE,
      filePath: parsed.filePath,
      body: parsed.body,
    };
  }
  return {
    kind: CommentAnchorKinds.LINE,
    filePath: parsed.filePath,
    side: parsed.side,
    startSide: parsed.startSide,
    startLine: parsed.startLine,
    endLine: parsed.endLine,
    body: parsed.body,
  };
}

export function reanchorDraftPatch(parsed: AnchorParsed): DraftCommentPatch {
  if (parsed.kind === CommentAnchorKinds.FILE) {
    return {
      kind: CommentAnchorKinds.FILE,
      filePath: parsed.filePath,
      anchorStatus: null,
    };
  }
  return {
    kind: CommentAnchorKinds.LINE,
    filePath: parsed.filePath,
    side: parsed.side,
    startSide: parsed.startSide,
    startLine: parsed.startLine,
    endLine: parsed.endLine,
    anchorStatus: null,
  };
}
