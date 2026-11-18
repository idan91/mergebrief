import {
  isLineCommentAnchor,
  type CommentAnchor,
  type LineCommentAnchor,
} from "../../utils/comments";

// Text typed into a line or file composer before Save, for the life of the
// tab. Keyed per Brief, so it never lands on a shifted line in another
// revision. Nothing here reaches the server: Save stages the draft.
const KEY_PREFIX = "mergebrief.unsavedComment.";

export type UnsavedCommentKey = `${typeof KEY_PREFIX}${string}`;

function describeLineAnchor(anchor: LineCommentAnchor): string {
  const startSide = anchor.startSide ?? anchor.side;
  return `line:${startSide}${anchor.startLine}-${anchor.side}${anchor.endLine}:${anchor.file}`;
}

/** A file anchor names its file only, so the header that hosts it completes the key. */
export function buildUnsavedCommentKey(
  briefId: string,
  anchor: CommentAnchor,
  host: string | undefined,
): UnsavedCommentKey | undefined {
  if (isLineCommentAnchor(anchor)) {
    return `${KEY_PREFIX}${briefId}.${describeLineAnchor(anchor)}`;
  }
  if (host === undefined) {
    return undefined;
  }
  return `${KEY_PREFIX}${briefId}.file:${host}:${anchor.file}`;
}

export function readUnsavedCommentText(key: UnsavedCommentKey): string {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    // Storage denied or no window: the composer works in memory only.
    return "";
  }
}

/** True when the text is held; false leaves it in memory only, silently. */
export function writeUnsavedCommentText(
  key: UnsavedCommentKey,
  body: string,
): boolean {
  try {
    if (body === "") {
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, body);
    }
    return true;
  } catch {
    return false;
  }
}
