// The partial fold: a comment whose anchor GitHub rejects becomes a quoted
// block in the review body.
import type { PublishComment } from "../types";
import { isFileGitHubAnchor } from "./anchor";

/** One rejected comment as the fold writes it: its anchor in bold, then its body. */
export function shapeFoldedCommentBlock(comment: PublishComment): string {
  const { anchor } = comment;
  if (isFileGitHubAnchor(anchor)) {
    return [`**\`${anchor.path}\`**`, "", comment.body].join("\n");
  }
  const twoSide =
    anchor.startSide !== undefined && anchor.startSide !== anchor.side;
  let range = String(anchor.line);
  if (twoSide) {
    // Cross-side line numbers need their sides spelled out to mean anything.
    range = `${anchor.startSide} ${anchor.startLine}-${anchor.side} ${anchor.line}`;
  } else if (anchor.startLine !== undefined) {
    range = `${anchor.startLine}-${anchor.line}`;
  }
  return [`**\`${anchor.path}:${range}\`**`, "", comment.body].join("\n");
}

/** A partial fold says how many of how many; a full one reads as the set it is. */
function shapeFoldPreamble(folded: number, total: number): string {
  if (folded < total) {
    return `${String(folded)} of ${String(total)} comments could not be anchored to the diff and were folded into this review body:`;
  }
  if (folded === 1) {
    return "This comment could not be anchored to the diff, so it is included here:";
  }
  return `These ${String(folded)} comments could not be anchored to the diff, so they are included here:`;
}

/**
 * The review body with the rejected comments folded in as quoted blocks.
 * Nothing rejected returns the body as given, `undefined` included.
 */
export function foldCommentsIntoBody(
  body: string | undefined,
  rejected: readonly PublishComment[],
  total: number,
): string | undefined {
  if (rejected.length === 0) {
    return body;
  }
  const preamble = shapeFoldPreamble(rejected.length, total);
  const sections: string[] = [];
  if (body !== undefined && body.trim() !== "") {
    sections.push(body);
  }
  sections.push("---", preamble, ...rejected.map(shapeFoldedCommentBlock));
  return sections.join("\n\n");
}
