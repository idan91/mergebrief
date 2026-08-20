// Unsent reply text, keyed per thread root comment id, for the life of the
// tab. A reply is a plain external write, so nothing here is ever sent to our
// server — sessionStorage is the whole persistence story.
const KEY_PREFIX = "mergebrief.replyDraft.";

export function readReplyDraft(threadId: number): string {
  try {
    return sessionStorage.getItem(`${KEY_PREFIX}${threadId}`) ?? "";
  } catch {
    // Storage denied (private mode, blocked cookies) or no window at all:
    // in-memory only beats refusing to render the composer.
    return "";
  }
}

export function writeReplyDraft(threadId: number, body: string): void {
  try {
    const key = `${KEY_PREFIX}${threadId}`;
    if (body === "") sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, body);
  } catch {
    // Best-effort, exactly like the read: never a user-visible failure.
  }
}
