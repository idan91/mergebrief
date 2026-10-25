import type { TFunction } from "i18next";
import type { Logger } from "logging";
import { buildHeadEntryBodies } from "../../entry-comment";
import type { EntryCommentManager, UnreadHeadRead } from "../types";

export interface UnreadHeadPost {
  readonly entryCommentManager: EntryCommentManager;
  readonly translate: TFunction;
  /** The head's deep-link index, the one its own bodies carry. */
  readonly headIndex: number;
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
): Promise<void> {
  const { entryCommentManager, translate, headIndex, log } = post;
  log.warn("generate: head unread, the Entry replaces only this head's body", {
    error: read.error,
  });
  const ownBodies = buildHeadEntryBodies(
    translate,
    entryCommentManager.buildDeepLink(headIndex),
  );
  await entryCommentManager.replace(body, ownBodies);
}
