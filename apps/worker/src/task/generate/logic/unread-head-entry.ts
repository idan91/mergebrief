import type { Logger } from "logging";
import { isHeadEntryBody } from "../../entry-comment";
import type { EntryCommentManager, EntryWrite, UnreadHeadRead } from "../types";

export interface UnreadHeadPost {
  readonly entryCommentManager: EntryCommentManager;
  /** The run's head, the one its own bodies name. */
  readonly headSha: string;
  readonly log: Logger;
}

/**
 * An Entry post whose head read failed: GitHub may already name a newer
 * head, so `body` replaces only a live body that names this head and never
 * creates the comment.
 */
export async function replaceOnUnreadHead(
  post: UnreadHeadPost,
  body: string,
  read: UnreadHeadRead,
): Promise<EntryWrite> {
  const { entryCommentManager, headSha, log } = post;
  log.warn("generate: head unread, the Entry replaces only this head's body", {
    error: read.error,
  });
  return entryCommentManager.replace(body, (live) =>
    isHeadEntryBody(live, headSha),
  );
}
