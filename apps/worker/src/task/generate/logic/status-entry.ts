import type { GenerationStatus } from "types/generations";
import type { EntryBodyKind } from "../../entry-comment/types";
import { HeadReadings, type EntryWrite, type RunContext } from "../types";
import { queueEntrySync, queueEntrySyncOnLostWrite } from "./entry-sync";

/** An Entry body that belongs to one row status: the held or on-demand body. */
export interface StatusEntryPost {
  readonly body: string;
  /** The status the row must still hold; a Generate click moves it on. */
  readonly status: GenerationStatus;
  /** The body's kind, named in the log lines. */
  readonly label: EntryBodyKind;
  /** Writes the body once the row and the head are both read current. */
  readonly write: (body: string) => Promise<EntryWrite>;
}

/**
 * Posts a status's body unless it is live already. The row is read again
 * first, since a click may move it on and its run posts its own body, and a
 * newer head's thread is left to it. An unread head stands the post down and
 * queues the head's sync, as a write that fails or loses its swap does.
 */
export async function postStatusEntry(
  context: RunContext,
  post: StatusEntryPost,
): Promise<void> {
  const { entryCommentManager, projection, target, watch, log } = context;
  if (await entryCommentManager.matches(post.body)) {
    log.info(`generate: ${post.label} entry already live, left as it is`);
    return;
  }
  const current = await projection.get(target);
  if (current?.status !== post.status) {
    log.info(`generate: head left ${post.status}, ${post.label} entry skipped`);
    return;
  }

  const head = await watch.readHead();
  if (head.kind === HeadReadings.MOVED) {
    log.info("generate: head moved, leaving the Entry comment to it");
    return;
  }
  if (head.kind === HeadReadings.UNREAD) {
    log.warn(`generate: head unread, the ${post.label} Entry stands down`, {
      error: head.error,
    });
    await queueEntrySync(context);
    return;
  }

  const written = await post.write(post.body);
  await queueEntrySyncOnLostWrite(context, written);
}
