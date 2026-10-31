import { buildEntryCommentBody } from "../../entry-comment";
import { HeadReadings, type RunContext } from "../types";
import {
  resolveReadyEntryAllowed,
  resolveRunEntryCommentAllowed,
} from "./entry-comment-gate";
import { queueEntrySync, queueEntrySyncOnLostWrite } from "./entry-sync";
import { readEntryPostHead } from "./supersession-watch";
import { replaceOnUnreadHead } from "./unread-head-entry";

/**
 * The ready Entry, once the artifact exists. On a rerun over a stored brief
 * an identical ready body must not re-ping; only that case needs the read, a
 * fresh run still carries a generating body and always refreshes. A post
 * that fails, or stands down on an unread head or a draft's closed gate,
 * queues the head's sync, which reads the head and the gate again: an
 * unreadable `settings.yaml` retries there, an opt-out stands down.
 */
export async function postReadyEntry(
  context: RunContext,
  entryCommentAllowed: boolean,
  headIndex: number,
): Promise<void> {
  const { deps, payload, prInfo, source, watch, entryCommentManager, log } =
    context;
  const head = await readEntryPostHead(watch);
  if (head.kind === HeadReadings.MOVED) {
    log.info("generate: head moved, leaving the ready Entry to the newer head");
    return;
  }
  const readyEntryAllowed = await resolveReadyEntryAllowed(payload, {
    prInfo,
    source,
    entryCommentAllowed,
    log,
  });
  if (!readyEntryAllowed) {
    if (prInfo.draft) {
      await queueEntrySync(context);
    }
    return;
  }

  const readyBody = buildEntryCommentBody(
    deps.translate,
    entryCommentManager.buildDeepLink(headIndex),
  );
  if (head.kind === HeadReadings.UNREAD) {
    const translate = deps.translate;
    const { headSha } = payload;
    const post = { entryCommentManager, translate, headSha, log };
    await replaceOnUnreadHead(post, readyBody, head);
    await queueEntrySync(context);
    return;
  }
  const alreadyLive =
    context.existingBrief !== undefined &&
    (await entryCommentManager.matches(readyBody));
  if (alreadyLive) {
    log.info(
      "generate: entry comment already current — skipping repost (no re-ping)",
    );
    return;
  }
  const write = await entryCommentManager.refresh(readyBody);
  await queueEntrySyncOnLostWrite(context, write);
}

/** What a capped run over a stored brief still does: the Entry reaches no model. */
export async function postOwedReadyEntry(
  context: RunContext,
  headIndex: number,
): Promise<void> {
  const entryCommentAllowed = await resolveRunEntryCommentAllowed(context);
  await postReadyEntry(context, entryCommentAllowed, headIndex);
}
