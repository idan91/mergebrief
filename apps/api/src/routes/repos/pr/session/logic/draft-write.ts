// Parsed draft writes as the store's anchor union: a File comment has no line
// columns, and a stored two-side range keeps its start side.
import type { DraftAnchor, NewDraft } from "persistence";
import { CommentAnchorKinds } from "types/comments";
import type { z } from "zod/v4";
import type { anchorSchema, createDraftSchema } from "../schemas";

type CreateDraftParsed = z.infer<typeof createDraftSchema>;
type AnchorParsed = z.infer<typeof anchorSchema>;

export function shapeDraftAnchor(parsed: AnchorParsed): DraftAnchor {
  if (parsed.kind === CommentAnchorKinds.FILE) {
    return { kind: CommentAnchorKinds.FILE, file: parsed.filePath };
  }

  const line = {
    kind: CommentAnchorKinds.LINE,
    file: parsed.filePath,
    side: parsed.side,
    startLine: parsed.startLine,
    endLine: parsed.endLine,
  };
  if (parsed.startSide === null) {
    return line;
  }
  return { ...line, startSide: parsed.startSide };
}

export function shapeNewDraft(parsed: CreateDraftParsed): NewDraft {
  return { anchor: shapeDraftAnchor(parsed), body: parsed.body };
}
