import { entryCommentBody } from "../../entry-comment";
import { acquireRepoConfig } from "../../repo-config";
import type { RunContext } from "../types";
import {
  resolveEntryCommentAllowed,
  resolveReadyEntryAllowed,
} from "./entry-comment-gate";

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
  const { payload, prInfo, source, watch, entryCommentManager, log } = context;
  await watch.assertCurrent();
  const readyEntryAllowed = await resolveReadyEntryAllowed(payload, {
    prInfo,
    source,
    entryCommentAllowed,
    log,
  });
  if (!readyEntryAllowed) {
    return;
  }

  const readyBody = entryCommentBody(
    entryCommentManager.buildDeepLink(headIndex),
  );
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
  const { payload, prInfo, source, entryCommentManager, log } = context;
  const repoConfig = prInfo.draft
    ? await acquireRepoConfig(source, log)
    : undefined;
  const entryCommentAllowed = await resolveEntryCommentAllowed(payload, {
    prInfo,
    repoConfig,
    entryCommentManager,
    log,
  });
  await postReadyEntry(context, entryCommentAllowed, headIndex);
}
