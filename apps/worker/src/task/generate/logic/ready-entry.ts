import { buildEntryCommentBody } from "../../entry-comment";
import { HeadReadings, type RunContext } from "../types";
import {
  resolveReadyEntryAllowed,
  resolveRunEntryCommentAllowed,
} from "./entry-comment-gate";
import { readEntryPostHead } from "./supersession-watch";
import { replaceOnUnreadHead } from "./unread-head-entry";

/**
 * The ready Entry, once the artifact exists. On a rerun over a stored brief
 * an identical ready body must not re-ping; only that case needs the read, a
 * fresh run still carries a generating body and always refreshes.
 */
export async function postReadyEntry(
  context: RunContext,
  entryCommentAllowed: boolean,
  headIndex: number,
): Promise<void> {
  const { deps, payload, prInfo, source, watch, entryCommentManager, log } =
    context;
  const head = await readEntryPostHead(watch);
  const readyEntryAllowed = await resolveReadyEntryAllowed(payload, {
    prInfo,
    source,
    entryCommentAllowed,
    log,
  });
  if (!readyEntryAllowed) {
    return;
  }

  const readyBody = buildEntryCommentBody(
    deps.translate,
    entryCommentManager.buildDeepLink(headIndex),
  );
  if (head.kind === HeadReadings.UNREAD) {
    const translate = deps.translate;
    const post = { entryCommentManager, translate, headIndex, log };
    await replaceOnUnreadHead(post, readyBody, head);
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
  await entryCommentManager.refresh(readyBody);
}

/** What a capped run over a stored brief still does: the Entry reaches no model. */
export async function postOwedReadyEntry(
  context: RunContext,
  headIndex: number,
): Promise<void> {
  const entryCommentAllowed = await resolveRunEntryCommentAllowed(context);
  await postReadyEntry(context, entryCommentAllowed, headIndex);
}
